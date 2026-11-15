// Settings API (function URL). Onboarding saves the elder's settings here; the Analyze,
// Agent and Ingest Lambdas read them on every request.
//   GET ?elderId=e-01         -> settings without the verification answer
//   PUT {elderId, ...fields}  -> updates only the fields given
// Only elders that already exist (seeded by the Data stack) can be changed.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BadRequest } from '../analyze/rules.js';
import { ddb } from '../shared/db.js';
import { json, readBody } from '../shared/http.js';
import { parseSettingsPatch } from './rules.js';

const ELDERS_TABLE = process.env.ELDERS_TABLE!;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const method = event.requestContext.http.method;
    if (method === 'GET') {
      const elderId = event.queryStringParameters?.elderId;
      if (!elderId) throw new BadRequest('elderId query parameter is required');
      const { Item } = await ddb.send(new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId } }));
      if (!Item) return json(404, { error: 'unknown elder' });
      const { verificationAnswer, connections: _, ...settings } = Item;
      return json(200, { ...settings, hasVerificationAnswer: Boolean(verificationAnswer) });
    }
    if (method === 'PUT') {
      const { elderId, patch } = parseSettingsPatch(readBody(event));
      const keys = Object.keys(patch);
      await ddb.send(
        new UpdateCommand({
          TableName: ELDERS_TABLE,
          Key: { elderId },
          UpdateExpression: `SET ${keys.map((k) => `#${k} = :${k}`).join(', ')}`,
          ConditionExpression: 'attribute_exists(elderId)',
          ExpressionAttributeNames: Object.fromEntries(keys.map((k) => [`#${k}`, k])),
          ExpressionAttributeValues: Object.fromEntries(keys.map((k) => [`:${k}`, patch[k as keyof typeof patch]])),
        }),
      );
      console.log(JSON.stringify({ elderId, updated: keys }));
      return json(200, { updated: keys });
    }
    return json(405, { error: 'use GET or PUT' });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: err.message });
    if (err instanceof ConditionalCheckFailedException) return json(404, { error: 'unknown elder' });
    console.error('settings failed', err);
    return json(500, { error: 'settings failed' });
  }
};
