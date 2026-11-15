import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AnalyzeRequest, RiskState } from '../../../contracts/index.js';
import { askClaude } from '../shared/bedrock.js';
import { json, readBody } from '../shared/http.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { BadRequest, decide, parseRequest, parseVerdict, recentWindow, type ModelVerdict } from './rules.js';

const sns = new SNSClient({});

const MODEL_ID = process.env.MODEL_ID!;
const ELDER_NAME = process.env.ELDER_NAME ?? 'the elder';
const VERIFICATION_QUESTION = process.env.VERIFICATION_QUESTION ?? '';
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const started = Date.now();
  let req: AnalyzeRequest;
  try {
    req = parseRequest(readBody(event));
  } catch (err) {
    return json(400, { error: err instanceof BadRequest ? err.message : 'bad request' });
  }

  const window = recentWindow(req.utterances);
  const empty: ModelVerdict = { risk: 0, tactics: [], reason: '', claimedRelative: false, elderState: 'none' };
  if (window.length === 0) return json(200, state(req, empty));

  let verdict: ModelVerdict;
  try {
    verdict = parseVerdict(await askClaude(MODEL_ID, SYSTEM_PROMPT, buildUserMessage(ELDER_NAME, window), 200));
  } catch (err) {
    // Keep the last level on failure; the app shows it while waiting.
    console.error('bedrock failed', err);
    return json(502, { error: 'scoring failed', level: req.prevLevel });
  }
  const bedrockMs = Date.now() - started;

  const result = state(req, verdict);
  if (decide(verdict, req).shouldAlert) {
    try {
      await alertFamily(req, result);
      result.familyAlerted = true;
    } catch (err) {
      console.error('sns publish failed', err);
    }
  }

  console.log(
    JSON.stringify({
      callId: req.callId,
      level: result.level,
      risk: result.risk,
      tactics: result.tactics,
      elderState: result.elderState,
      action: result.action,
      bedrockMs,
      totalMs: Date.now() - started,
    }),
  );
  return json(200, result);
};

function state(req: AnalyzeRequest, v: ModelVerdict): RiskState {
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
    elderState: v.elderState,
    verificationQuestion: d.action === 'ask_verification' ? VERIFICATION_QUESTION : undefined,
    familyAlerted: false,
  };
}

async function alertFamily(req: AnalyzeRequest, s: RiskState): Promise<void> {
  // Only the last few lines go in the alert (privacy section of the design doc).
  const lastLines = recentWindow(req.utterances)
    .slice(-3)
    .map((u) => `"${u.text.slice(0, 120)}"`)
    .join(' ');
  const message =
    `Scam Shield: ${ELDER_NAME} is on a likely scam call and is starting to go along with it. ` +
    `Signs: ${s.tactics.join(', ').replaceAll('_', ' ')}. ${s.reason} ` +
    `Last words: ${lastLines} Please call them now.`;
  await sns.send(
    new PublishCommand({
      TopicArn: FAMILY_TOPIC_ARN,
      Subject: `Scam alert: ${ELDER_NAME} may be on a scam call`,
      Message: message.slice(0, 1400),
    }),
  );
}
