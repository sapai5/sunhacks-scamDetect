// IngestFn: the phone path's front end (the Twilio bridge, later Connect) invokes this once per
// finished sentence (IngestRequest, direct Lambda invoke). Call state lives in the Calls table
// instead of the browser; scoring is the Analyze Lambda's code. Returns the new RiskState, or null
// while the agent has the call or for the agent's own lines (recorded, never scored).
// Each change reaches the app through the Calls stream (push Lambda).
//
// Agent takeover on the phone path (the front end runs the agent, like the browser does):
//   front end sets agentStatus idle -> active   (the agent has the call; scoring pauses)
//   front end sends each agent line here         (speaker 'agent': shown in the app)
//   app's "Let me talk" sets active -> stopped   (push Lambda; the front end checks before speaking)
//   front end sets active -> final status        (verified / scam_confirmed / caller_left)
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand, type UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import type { AgentStatus, AnalyzeRequest, IngestRequest, RiskState, Utterance, Verification } from '../../../contracts/index.js';
import { parseIngest, parseRescore } from '../analyze/rules.js';
import { alertFamily, score } from '../analyze/score.js';
import { ddb, loadElder } from '../shared/db.js';

const CALLS_TABLE = process.env.CALLS_TABLE!;
const TTL_SECONDS = 24 * 3600;

/** One item per call in the Calls table. */
interface CallItem {
  callId: string;
  elderId: string;
  /** Caller, elder and agent lines, in arrival order. */
  utterances: Pick<Utterance, 'speaker' | 'text' | 'ts'>[];
  verification: Verification;
  agentStatus: AgentStatus;
  /** How the takeover ended (written by the front end). */
  agentSummary?: string;
  familyAlerted: boolean;
  /** Latest result; the stream pushes it to the app when it changes. */
  state?: RiskState;
  /** Index of the sentence `state` was scored at. */
  analyzedSeq?: number;
  /** TTL, epoch seconds. */
  expiresAt: number;
}

/** UpdateItem on the Calls table. Returns false instead of throwing when the condition fails. */
async function update(input: Omit<UpdateCommandInput, 'TableName'>): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({ TableName: CALLS_TABLE, ...input }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** 1. Append the sentence. ALL_NEW returns the call with this sentence last. */
async function append(req: IngestRequest): Promise<CallItem> {
  // ponytail: the whole transcript is one item (400 KB, about 2,000 sentences); trim it if calls run longer.
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: CALLS_TABLE,
      Key: { callId: req.callId },
      UpdateExpression:
        'SET utterances = list_append(if_not_exists(utterances, :none), :u), elderId = if_not_exists(elderId, :e), ' +
        'verification = if_not_exists(verification, :unasked), agentStatus = if_not_exists(agentStatus, :idle), ' +
        'familyAlerted = if_not_exists(familyAlerted, :no), expiresAt = :exp',
      ExpressionAttributeValues: {
        ':none': [],
        ':u': [{ speaker: req.speaker, text: req.text, ts: req.ts }],
        ':e': req.elderId,
        ':unasked': 'unasked',
        ':idle': 'idle',
        ':no': false,
        ':exp': Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes as CallItem;
}

export const handler = async (event: unknown): Promise<RiskState | null> => {
  const started = Date.now();
  // A rescore (push Lambda: the elder answered the family question) scores the stored transcript again.
  const rescore = parseRescore(event);
  const req = rescore ? undefined : parseIngest(event);
  const call = req
    ? await append(req)
    : ((await ddb.send(new GetCommand({ TableName: CALLS_TABLE, Key: { callId: rescore!.callId } }))).Item as CallItem | undefined);
  if (!call?.utterances?.length) return null;
  const Key = { callId: call.callId };
  const seq = call.utterances.length - 1;
  // The agent's own lines are only recorded, and nothing is scored while it has the call (like the browser).
  if (req?.speaker === 'agent' || call.agentStatus === 'active') return null;

  // 2. Same scoring as the Analyze Lambda, with the stored state in place of the browser's.
  const areq: AnalyzeRequest = {
    callId: call.callId,
    elderId: call.elderId,
    utterances: call.utterances.map((u, i) => ({ ...u, callId: call.callId, elderId: call.elderId, seq: i })),
    prevLevel: call.state?.level ?? 'green',
    calmStreak: call.state?.calmStreak ?? 0,
    verification: call.verification,
    familyAlerted: call.familyAlerted,
    agentStatus: call.agentStatus,
  };
  const elder = await loadElder(call.elderId);
  const { state, shouldAlert, bedrockMs } = await score(areq, elder);

  // 3. Alert once per call, even when two sentences are scored at the same time.
  const flag = (from: boolean, to: boolean) =>
    update({ Key, UpdateExpression: 'SET familyAlerted = :to', ConditionExpression: 'familyAlerted = :from', ExpressionAttributeValues: { ':from': from, ':to': to } });
  if (shouldAlert && (await flag(false, true))) {
    try {
      await alertFamily(elder, areq, state);
      state.familyAlerted = true;
    } catch (err) {
      console.error('sns publish failed', err);
      await flag(true, false); // let the next sentence try again
    }
  }

  // 4. Save, unless a later sentence was already scored (the same one may be: a rescore). agentStatus is the front end's.
  // ponytail: overlapping scores of the same sentence (it and a rescore) finish in any order, so a rescore can
  // occasionally lose to the score it replaces until the next sentence; SQS FIFO per callId (Stage 3) serializes them.
  const saved = await update({
    Key,
    UpdateExpression: 'SET #state = :s, analyzedSeq = :seq',
    ConditionExpression: 'attribute_not_exists(analyzedSeq) OR analyzedSeq <= :seq',
    ExpressionAttributeNames: { '#state': 'state' },
    ExpressionAttributeValues: { ':s': state, ':seq': seq },
  });

  console.log(
    JSON.stringify({
      callId: call.callId,
      rescore: Boolean(rescore),
      seq,
      level: state.level,
      risk: state.risk,
      tactics: state.tactics,
      elderState: state.elderState,
      action: state.action,
      saved,
      bedrockMs,
      totalMs: Date.now() - started,
    }),
  );
  return state;
};
