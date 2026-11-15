// Events Lambda: the app reports call events (hang-up, off/on speaker, caller asking to go off
// speaker). Texts the family when an event changes what they should do (see familyMessage).
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { CallEventResponse } from '../../../contracts/index.js';
import { BadRequest, familyMessage, parseEventRequest } from './logic.js';

const sns = new SNSClient({});
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;
const ELDER_NAME = process.env.ELDER_NAME ?? 'your family member';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  let req;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    if (raw.length > 16 * 1024) throw new BadRequest('body too large');
    req = parseEventRequest(JSON.parse(raw || 'null'));
  } catch (err) {
    return json(400, { error: err instanceof BadRequest ? err.message : 'invalid JSON' });
  }

  const message = familyMessage(req, ELDER_NAME);
  let notified = false;
  if (message) {
    try {
      await sns.send(new PublishCommand({ TopicArn: FAMILY_TOPIC_ARN, Message: message.slice(0, 1400) }));
      notified = true;
    } catch (err) {
      console.error('sns publish failed', err);
    }
  }
  console.log(JSON.stringify({ callId: req.callId, type: req.type, source: req.source, level: req.level, notified }));
  return json(200, { notified } satisfies CallEventResponse);
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
