// Push: the WebSocket API's routes and the Calls table stream, in one function.
// - $connect: the app connects with ?elderId=e-01; the socket is added to the Elders item
//   (string set `connections`). Closed sockets are removed the next time a push to them fails.
// - Calls stream: each change to a call's RiskState or phone agent progress is sent to the
//   elder's open sockets as a PushMessage.
// - $default: messages from the app (PushAppMessage) about a phone call:
//   {action: 'stopAgent'}    "Let me talk" during a takeover: the agent stops, scoring resumes.
//   {action: 'verification'} the elder's answer on the Checking screen: saved on the call, and
//                            IngestFn scores it again right away (a wrong answer turns it red).
//   {action: 'current'}      sent on connect: replies with the elder's live (or just ended) call, so an
//                            app opened from a notification shows the call without waiting for a change.
//   {action: 'vapidKey'}     replies with the Web Push key; {action: 'subscribePush' | 'unsubscribePush'}
//                            saves or removes this phone's subscription on the Elders item (`webPush` map).
// - Web Push: at the moments in shared/elderAlerts.ts (red, takeover, agent done, call over) each
//   subscribed phone gets a notification, once per call per moment (Calls.elderAlerts records them).
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2, DynamoDBStreamEvent } from 'aws-lambda';
import type { IngestRescore, PushMessage, PushVapidKeyReply, WebPushSubscription } from '../../../contracts/index.js';
import { ddb } from '../shared/db.js';
import { elderAlertsFor, type AlertView } from '../shared/elderAlerts.js';
import { parseAppMessage, subscriptionKey } from './rules.js';
import { sendNotification, vapidKeys } from './webPush.js';

const ELDERS_TABLE = process.env.ELDERS_TABLE!;
const CALLS_TABLE = process.env.CALLS_TABLE!;
const INGEST_FN = process.env.INGEST_FN!;
const lambda = new LambdaClient({});
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',');
const api = new ApiGatewayManagementApiClient({ endpoint: process.env.CALLBACK_URL });

/** $connect carries the query string and headers; the aws-lambda type leaves them out. */
type SocketEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

export const handler = async (event: DynamoDBStreamEvent | SocketEvent): Promise<APIGatewayProxyResultV2 | void> => {
  if ('Records' in event) return pushChanges(event);
  return event.requestContext.routeKey === '$connect' ? connect(event) : fromApp(event.body, event.requestContext.connectionId);
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

async function fromApp(body: string | undefined, connectionId: string): Promise<APIGatewayProxyResultV2> {
  const msg = parseAppMessage(body);
  if (!msg) return { statusCode: 400 };
  if (msg.action === 'vapidKey') {
    const reply: PushVapidKeyReply = { vapidKey: (await vapidKeys()).publicKey };
    await postTo(connectionId, JSON.stringify(reply));
    return { statusCode: 200 };
  }
  if (msg.action === 'current') {
    const current = await currentCall(msg.elderId);
    if (current) await postTo(connectionId, JSON.stringify(current));
    return { statusCode: 200 };
  }
  if ('subscription' in msg) {
    await saveSubscription(msg.elderId, msg.subscription, msg.action === 'subscribePush');
    return { statusCode: 200 };
  }
  // ponytail: any socket that passed the origin check can change a call it knows the callId of
  // (a Twilio CallSid, so not guessable); per-elder auth comes with Cognito (Stage 3).
  if (msg.action === 'stopAgent') {
    await updateCall(msg.callId, 'SET agentStatus = :stopped', 'agentStatus = :active', { ':stopped': 'stopped', ':active': 'active' });
  } else if (await updateCall(msg.callId, 'SET verification = :v', 'attribute_exists(callId)', { ':v': msg.result })) {
    // Score again now, like the browser does, instead of waiting for the caller's next sentence.
    const rescore: IngestRescore = { callId: msg.callId, rescore: true };
    await lambda.send(new InvokeCommand({ FunctionName: INGEST_FN, InvocationType: 'Event', Payload: JSON.stringify(rescore) }));
  }
  return { statusCode: 200 };
}

/** UpdateItem on a call. Returns false when the condition fails (no such call, or the agent already finished). */
async function updateCall(callId: string, expression: string, condition: string, values: Record<string, unknown>): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: CALLS_TABLE,
        Key: { callId },
        UpdateExpression: expression,
        ConditionExpression: condition,
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** What the app sees of a call: its RiskState plus the phone agent's progress. */
function message(call: Record<string, any> | undefined): PushMessage | undefined {
  if (!call?.state) return undefined;
  const lastAgentLine = [...(call.utterances ?? [])].reverse().find((u) => u.speaker === 'agent');
  return {
    ...call.state,
    agentStatus: call.agentStatus ?? 'idle',
    agentSummary: call.agentSummary,
    agentSay: lastAgentLine?.text,
    ended: call.ended === true || undefined,
  };
}

async function pushChanges(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    const { NewImage, OldImage } = record.dynamodb ?? {};
    if (!NewImage) continue;
    const call = unmarshall(NewImage as Parameters<typeof unmarshall>[0]);
    const old = OldImage ? unmarshall(OldImage as Parameters<typeof unmarshall>[0]) : undefined;
    const now = message(call);
    const before = message(old);
    // Appending a caller or elder sentence alone changes nothing the app shows.
    if (now && JSON.stringify(now) !== JSON.stringify(before)) {
      await push(call.elderId, now);
      await notify(call, old);
    }
  }
}

/** The parts of a call the alert rule looks at. Peak = red once the family was alerted. */
function alertView(call: Record<string, any> | undefined): AlertView | undefined {
  if (!call?.state) return undefined;
  return {
    level: call.state.level,
    agentStatus: call.agentStatus ?? 'idle',
    ended: call.ended === true,
    peak: call.familyAlerted || call.state.familyAlerted ? 'red' : call.state.level,
    exposures: call.state.exposures,
  };
}

/** Web Push to the elder's subscribed phones at alert moments, each moment once per call. */
async function notify(call: Record<string, any>, old: Record<string, any> | undefined): Promise<void> {
  const now = alertView(call);
  if (!now) return;
  const { Item: elder } = await ddb.send(
    new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId: call.elderId }, ProjectionExpression: 'webPush, agentName' }),
  );
  const subs = Object.entries((elder?.webPush ?? {}) as Record<string, WebPushSubscription>);
  if (!subs.length) return;
  for (const alert of elderAlertsFor(alertView(old), now, call.callId, elder?.agentName || 'Mike')) {
    // Claim the moment first, so stream retries and parallel batches never send it twice.
    const claimed = await updateCall(call.callId, 'ADD elderAlerts :k', 'attribute_not_exists(elderAlerts) OR NOT contains(elderAlerts, :kind)', {
      ':k': new Set([alert.kind]),
      ':kind': alert.kind,
    });
    if (!claimed) continue;
    const payload = { title: alert.title, body: alert.body, url: alert.path, tag: `call-${call.callId}`, kind: alert.kind };
    await Promise.all(
      subs.map(async ([key, sub]) => {
        if ((await sendNotification(sub, payload)) !== 'gone') return;
        await ddb.send(
          new UpdateCommand({
            TableName: ELDERS_TABLE,
            Key: { elderId: call.elderId },
            UpdateExpression: 'REMOVE webPush.#k',
            ExpressionAttributeNames: { '#k': key },
          }),
        );
      }),
    );
  }
}

/** The elder's latest call, if it's live or ended in the last 10 minutes. */
async function currentCall(elderId: string): Promise<PushMessage | undefined> {
  const { Item: elder } = await ddb.send(new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId }, ProjectionExpression: 'lastCallId' }));
  if (typeof elder?.lastCallId !== 'string') return undefined;
  const { Item: call } = await ddb.send(new GetCommand({ TableName: CALLS_TABLE, Key: { callId: elder.lastCallId } }));
  const msg = message(call);
  if (!msg || (msg.ended && Date.now() - msg.updatedAt > 10 * 60_000)) return undefined;
  return msg;
}

/** Adds or removes this phone's Web Push subscription. Only existing (seeded) elders. */
async function saveSubscription(elderId: string, sub: WebPushSubscription, add: boolean): Promise<void> {
  const key = subscriptionKey(sub.endpoint);
  try {
    if (add) {
      // The map may not exist yet: create it, then set the entry (both writes are idempotent).
      await ddb.send(
        new UpdateCommand({
          TableName: ELDERS_TABLE,
          Key: { elderId },
          UpdateExpression: 'SET webPush = if_not_exists(webPush, :empty)',
          ConditionExpression: 'attribute_exists(elderId)',
          ExpressionAttributeValues: { ':empty': {} },
        }),
      );
      await ddb.send(
        new UpdateCommand({
          TableName: ELDERS_TABLE,
          Key: { elderId },
          UpdateExpression: 'SET webPush.#k = :sub',
          ExpressionAttributeNames: { '#k': key },
          ExpressionAttributeValues: { ':sub': sub },
        }),
      );
    } else {
      await ddb.send(
        new UpdateCommand({
          TableName: ELDERS_TABLE,
          Key: { elderId },
          UpdateExpression: 'REMOVE webPush.#k',
          ConditionExpression: 'attribute_exists(webPush)',
          ExpressionAttributeNames: { '#k': key },
        }),
      );
    }
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

/** One message to one socket. A closed socket is ignored here (push() cleans those up). */
async function postTo(connectionId: string, data: string): Promise<void> {
  try {
    await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
  } catch (err) {
    if (!(err instanceof GoneException)) throw err;
  }
}

async function push(elderId: string, msg: PushMessage): Promise<void> {
  // Remember the elder's latest call, for apps that connect later ({action: 'current'}).
  await ddb
    .send(
      new UpdateCommand({
        TableName: ELDERS_TABLE,
        Key: { elderId },
        UpdateExpression: 'SET lastCallId = :c',
        ConditionExpression: 'attribute_exists(elderId)',
        ExpressionAttributeValues: { ':c': msg.callId },
      }),
    )
    .catch((err) => {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    });
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
