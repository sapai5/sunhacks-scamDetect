import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AnalyzeRequest, RiskState } from '../../../contracts/index.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { BadRequest, decide, parseRequest, parseVerdict, recentWindow, type ModelVerdict } from './rules.js';

const bedrock = new BedrockRuntimeClient({});
const sns = new SNSClient({});

const MODEL_ID = process.env.MODEL_ID!;
const ELDER_NAME = process.env.ELDER_NAME ?? 'the elder';
const VERIFICATION_QUESTION = process.env.VERIFICATION_QUESTION ?? '';
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;
const MAX_BODY_BYTES = 256 * 1024;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const started = Date.now();
  let req: AnalyzeRequest;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    if (raw.length > MAX_BODY_BYTES) throw new BadRequest('body too large');
    req = parseRequest(JSON.parse(raw || 'null'));
  } catch (err) {
    const msg = err instanceof BadRequest ? err.message : 'invalid JSON';
    return json(400, { error: msg });
  }

  const window = recentWindow(req.utterances);
  if (window.length === 0) {
    return json(200, state(req, { risk: 0, tactics: [], reason: '', claimedRelative: false }, false));
  }

  let verdict: ModelVerdict;
  try {
    verdict = await score(window);
  } catch (err) {
    // Keep the last level on failure; the app shows it while waiting.
    console.error('bedrock failed', err);
    return json(502, { error: 'scoring failed', level: req.prevLevel });
  }
  const bedrockMs = Date.now() - started;

  const result = state(req, verdict, false);
  if (decide(verdict, req).shouldAlert) {
    try {
      await alertFamily(req, result);
      result.familyAlerted = true;
    } catch (err) {
      console.error('sns publish failed', err);
    }
  }

  console.log(JSON.stringify({ callId: req.callId, level: result.level, risk: result.risk, tactics: result.tactics, bedrockMs, totalMs: Date.now() - started }));
  return json(200, result);
};

async function score(window: ReturnType<typeof recentWindow>): Promise<ModelVerdict> {
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 200,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(ELDER_NAME, window) }],
      }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(res.body)) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
  return parseVerdict(text);
}

function state(req: AnalyzeRequest, v: ModelVerdict, familyAlerted: boolean): RiskState {
  const d = decide(v, req);
  return {
    callId: req.callId,
    risk: d.risk,
    level: d.level,
    tactics: d.tactics,
    reason: v.reason,
    action: d.action,
    updatedAt: Date.now(),
    calmStreak: d.calmStreak,
    claimedRelative: v.claimedRelative,
    verificationQuestion: d.action === 'ask_verification' ? VERIFICATION_QUESTION : undefined,
    familyAlerted,
  };
}

async function alertFamily(req: AnalyzeRequest, s: RiskState): Promise<void> {
  // Only the last few lines go in the text (privacy section of the design doc).
  const lastLines = recentWindow(req.utterances)
    .slice(-3)
    .map((u) => `"${u.text.slice(0, 120)}"`)
    .join(' ');
  const message =
    `Scam Shield: ${ELDER_NAME} may be on a scam call right now. ` +
    `Signs: ${s.tactics.join(', ').replaceAll('_', ' ')}. ${s.reason} ` +
    `Last words: ${lastLines} Please call them.`;
  await sns.send(new PublishCommand({ TopicArn: FAMILY_TOPIC_ARN, Message: message.slice(0, 1400) }));
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
