import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AgentResponse } from '../../../contracts/index.js';
import { BadRequest, parseUtterances } from '../analyze/rules.js';
import { askClaude } from '../shared/bedrock.js';
import { loadElder } from '../shared/db.js';
import { json, readBody } from '../shared/http.js';
import { systemPrompt, userMessage } from './prompt.js';
import { parseAgentReply } from './rules.js';

const sns = new SNSClient({});
const MODEL_ID = process.env.MODEL_ID!;
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;

const FAMILY_HEADLINE: Record<string, string> = {
  verified: 'The caller passed the check and the call was handed back.',
  scam_confirmed: 'The caller failed the check. We told them goodbye; please call her now.',
  caller_left: 'The caller hung up after the takeover.',
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const started = Date.now();
  let callId: string;
  let elderId: string;
  let utterances;
  try {
    const body = readBody(event);
    if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
    ({ callId, elderId, utterances } = parseUtterances(body as Record<string, unknown>));
  } catch (err) {
    return json(400, { error: err instanceof BadRequest ? err.message : 'bad request' });
  }

  const persona = await loadElder(elderId);
  let outcome;
  try {
    // Last 60 lines is plenty: the scam lead-up plus the agent conversation.
    const recent = [...utterances].sort((a, b) => a.seq - b.seq).slice(-60);
    outcome = parseAgentReply(await askClaude(MODEL_ID, systemPrompt(persona), userMessage(recent), 250), utterances, persona.verificationAnswer);
  } catch (err) {
    console.error('agent turn failed', err);
    return json(502, { error: 'agent failed' });
  }

  const res: AgentResponse = { callId, ...outcome, familyNotified: false };
  if (res.status !== 'active') {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: FAMILY_TOPIC_ARN,
          Subject: `Scam Shield: update on ${persona.elderName}'s call`,
          Message: `Scam Shield took over ${persona.elderName}'s call as ${persona.agentName}. ${FAMILY_HEADLINE[res.status]} ${res.summary}`,
        }),
      );
      res.familyNotified = true;
    } catch (err) {
      console.error('sns publish failed', err);
    }
  }

  console.log(JSON.stringify({ callId, status: res.status, totalMs: Date.now() - started }));
  return json(200, res);
};
