// Push: the WebSocket API's $connect route and the Calls table stream, in one function.
// The app connects with ?elderId=e-01; each new RiskState for that elder's calls is sent to
// its open connections as JSON. Connection IDs live on the Elders item (string set
// `connections`); closed ones are removed the next time a push to them fails.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2, DynamoDBStreamEvent } from 'aws-lambda';
import type { RiskState } from '../../../contracts/index.js';
import { ddb } from '../shared/db.js';

const ELDERS_TABLE = process.env.ELDERS_TABLE!;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',');
const api = new ApiGatewayManagementApiClient({ endpoint: process.env.CALLBACK_URL });

/** $connect carries the query string and headers; the aws-lambda type leaves them out. */
type ConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

export const handler = async (event: DynamoDBStreamEvent | ConnectEvent): Promise<APIGatewayProxyResultV2 | void> =>
  'Records' in event ? pushChanges(event) : connect(event);

async function connect(event: ConnectEvent): Promise<APIGatewayProxyResultV2> {
  // Same origins as the function URLs' CORS (browsers always send Origin on a WebSocket).
  const origin = event.headers?.Origin ?? event.headers?.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return { statusCode: 403 };
  const elderId = event.queryStringParameters?.elderId;
  if (!elderId || elderId.length > 64) return { statusCode: 400 };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: ELDERS_TABLE,
        Key: { elderId },
        UpdateExpression: 'ADD connections :c',
        ConditionExpression: 'attribute_exists(elderId)',
        ExpressionAttributeValues: { ':c': new Set([event.requestContext.connectionId]) },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return { statusCode: 404 };
    throw err;
  }
  return { statusCode: 200 };
}

async function pushChanges(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    const { NewImage, OldImage } = record.dynamodb ?? {};
    if (!NewImage) continue;
    const call = unmarshall(NewImage as Parameters<typeof unmarshall>[0]);
    const prev = OldImage ? unmarshall(OldImage as Parameters<typeof unmarshall>[0]) : undefined;
    // Only new results: appending a sentence alone doesn't change `state`.
    if (call.state && call.state.updatedAt !== prev?.state?.updatedAt) await push(call.elderId, call.state);
  }
}

async function push(elderId: string, state: RiskState): Promise<void> {
  const { Item } = await ddb.send(new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId }, ProjectionExpression: 'connections' }));
  const data = JSON.stringify(state);
  await Promise.all(
    [...((Item?.connections as Set<string> | undefined) ?? [])].map(async (id) => {
      try {
        await api.send(new PostToConnectionCommand({ ConnectionId: id, Data: data }));
      } catch (err) {
        if (!(err instanceof GoneException)) return console.error('push failed', id, err);
        await ddb.send(
          new UpdateCommand({
            TableName: ELDERS_TABLE,
            Key: { elderId },
            UpdateExpression: 'DELETE connections :c',
            ExpressionAttributeValues: { ':c': new Set([id]) },
          }),
        );
      }
    }),
  );
}
