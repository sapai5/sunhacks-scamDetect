import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AnalyzeRequest } from '../../../contracts/index.js';
import { loadElder } from '../shared/db.js';
import { json, readBody } from '../shared/http.js';
import { BadRequest, parseRequest } from './rules.js';
import { alertFamily, score } from './score.js';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const started = Date.now();
  let req: AnalyzeRequest;
  try {
    req = parseRequest(readBody(event));
  } catch (err) {
    return json(400, { error: err instanceof BadRequest ? err.message : 'bad request' });
  }

  const elder = await loadElder(req.elderId);
  let scored;
  try {
    scored = await score(req, elder);
  } catch (err) {
    // Keep the last level on failure; the app shows it while waiting.
    console.error('bedrock failed', err);
    return json(502, { error: 'scoring failed', level: req.prevLevel });
  }

  const { state, shouldAlert, bedrockMs } = scored;
  if (shouldAlert) {
    try {
      await alertFamily(elder, req, state);
      state.familyAlerted = true;
    } catch (err) {
      console.error('sns publish failed', err);
    }
  }

  console.log(
    JSON.stringify({
      callId: req.callId,
      level: state.level,
      risk: state.risk,
      tactics: state.tactics,
      elderState: state.elderState,
      action: state.action,
      bedrockMs,
      totalMs: Date.now() - started,
    }),
  );
  return json(200, state);
};
