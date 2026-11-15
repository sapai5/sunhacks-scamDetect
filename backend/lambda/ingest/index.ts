// IngestFn: the phone path's transcriber invokes this once per finished sentence (IngestRequest,
// direct Lambda invoke). Call state lives in the Calls table instead of the browser; scoring is the
// Analyze Lambda's code. Returns the new RiskState, or null while the agent has the call.
// Each saved RiskState reaches the app through the Calls stream (push Lambda).
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, type UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import type { AgentStatus, AnalyzeRequest, RiskState, Utterance, Verification } from '../../../contracts/index.js';
import { parseIngest } from '../analyze/rules.js';
import { alertFamily, score } from '../analyze/score.js';
import { ddb, loadElder } from '../shared/db.js';

const CALLS_TABLE = process.env.CALLS_TABLE!;
const TTL_SECONDS = 24 * 3600;

/** One item per call in the Calls table. */
interface CallItem {
  callId: string;
  elderId: string;
  utterances: Pick<Utterance, 'speaker' | 'text' | 'ts'>[];
  verification: Verification;
  agentStatus: AgentStatus;
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

export const handler = async (event: unknown): Promise<RiskState | null> => {
  const started = Date.now();
  const req = parseIngest(event);
  const Key = { callId: req.callId };

  // 1. Append the sentence. ALL_NEW returns the call with this sentence last.
  // ponytail: the whole transcript is one item (400 KB, about 2,000 sentences); trim it if calls run longer.
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: CALLS_TABLE,
      Key,
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
  const call = Attributes as CallItem;
  const seq = call.utterances.length - 1;
  // Like the browser: no scoring while the agent is talking to the caller.
  if (call.agentStatus === 'active') return null;

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

  // 4. Save, unless a later sentence was already scored.
  // ponytail: overlapping sentences are scored from the same previous state; SQS FIFO per callId (Stage 3) serializes them.
  const takeover = state.action === 'agent_takeover';
  const saved = await update({
    Key,
    UpdateExpression: `SET #state = :s, analyzedSeq = :seq${takeover ? ', agentStatus = :active' : ''}`,
    ConditionExpression: 'attribute_not_exists(analyzedSeq) OR analyzedSeq < :seq',
    ExpressionAttributeNames: { '#state': 'state' },
    ExpressionAttributeValues: { ':s': state, ':seq': seq, ...(takeover ? { ':active': 'active' } : {}) },
  });

  console.log(
    JSON.stringify({
      callId: req.callId,
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
