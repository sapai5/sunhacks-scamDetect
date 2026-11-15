// Push: the WebSocket API's routes and the Calls table stream, in one function.
// - $connect: the app connects with ?elderId=e-01; the socket is added to the Elders item
//   (string set `connections`). Closed sockets are removed the next time a push to them fails.
// - Calls stream: each change to a call's RiskState or phone agent progress is sent to the
//   elder's open sockets as a PushMessage.
// - $default: messages from the app. {action: 'stopAgent', callId} is "Let me talk" during a
//   phone takeover: the agent stops and IngestFn goes back to scoring.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2, DynamoDBStreamEvent } from 'aws-lambda';
import type { PushMessage, PushStopAgent } from '../../../contracts/index.js';
import { ddb } from '../shared/db.js';

const ELDERS_TABLE = process.env.ELDERS_TABLE!;
const CALLS_TABLE = process.env.CALLS_TABLE!;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',');
const api = new ApiGatewayManagementApiClient({ endpoint: process.env.CALLBACK_URL });

/** $connect carries the query string and headers; the aws-lambda type leaves them out. */
type SocketEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

export const handler = async (event: DynamoDBStreamEvent | SocketEvent): Promise<APIGatewayProxyResultV2 | void> => {
  if ('Records' in event) return pushChanges(event);
  return event.requestContext.routeKey === '$connect' ? connect(event) : fromApp(event.body);
};

async function connect(event: SocketEvent): Promise<APIGatewayProxyResultV2> {
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

async function fromApp(body: string | undefined): Promise<APIGatewayProxyResultV2> {
  let msg: Partial<PushStopAgent>;
  try {
    msg = JSON.parse(body ?? '');
  } catch {
    return { statusCode: 400 };
  }
  if (msg?.action !== 'stopAgent' || typeof msg.callId !== 'string' || !msg.callId || msg.callId.length > 64) return { statusCode: 400 };
  // ponytail: any socket that passed the origin check can stop a call's agent if it knows the callId
  // (a Connect contact ID, so not guessable); per-elder auth comes with Cognito (Stage 3).
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: CALLS_TABLE,
        Key: { callId: msg.callId },
        UpdateExpression: 'SET agentStatus = :stopped',
        ConditionExpression: 'agentStatus = :active',
        ExpressionAttributeValues: { ':stopped': 'stopped', ':active': 'active' },
      }),
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err; // agent already done
  }
  return { statusCode: 200 };
}

/** What the app sees of a call: its RiskState plus the phone agent's progress. */
function message(call: Record<string, any> | undefined): PushMessage | undefined {
  if (!call?.state) return undefined;
  const lastAgentLine = [...(call.utterances ?? [])].reverse().find((u) => u.speaker === 'agent');
  return { ...call.state, agentStatus: call.agentStatus ?? 'idle', agentSummary: call.agentSummary, agentSay: lastAgentLine?.text };
}

async function pushChanges(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    const { NewImage, OldImage } = record.dynamodb ?? {};
    if (!NewImage) continue;
    const call = unmarshall(NewImage as Parameters<typeof unmarshall>[0]);
    const now = message(call);
    const before = message(OldImage ? unmarshall(OldImage as Parameters<typeof unmarshall>[0]) : undefined);
    // Appending a caller or elder sentence alone changes nothing the app shows.
    if (now && JSON.stringify(now) !== JSON.stringify(before)) await push(call.elderId, now);
  }
}

async function push(elderId: string, msg: PushMessage): Promise<void> {
  const { Item } = await ddb.send(new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId }, ProjectionExpression: 'connections' }));
  const data = JSON.stringify(msg);
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
