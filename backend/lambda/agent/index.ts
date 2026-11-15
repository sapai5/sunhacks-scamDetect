import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AgentResponse } from '../../../contracts/index.js';
import { BadRequest, parseUtterances } from '../analyze/rules.js';
import { loadElder } from '../shared/db.js';
import { json, readBody } from '../shared/http.js';
import { agentReply, notifyFamily } from './turn.js';

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
  let reply;
  try {
    reply = await agentReply(utterances, persona);
  } catch (err) {
    console.error('agent turn failed', err);
    return json(502, { error: 'agent failed' });
  }

  const res: AgentResponse = { callId, ...reply, familyNotified: false };
  if (res.status !== 'active') res.familyNotified = await notifyFamily(persona, reply);

  console.log(JSON.stringify({ callId, status: res.status, totalMs: Date.now() - started }));
  return json(200, res);
};
