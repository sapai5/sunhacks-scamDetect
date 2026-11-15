// Pure level rules. No AWS calls here so they can be unit tested.
import {
  AGENT_STATUSES,
  ELDER_STATES,
  LEVELS,
  TACTICS,
  VERIFICATIONS,
  type Action,
  type AgentStatus,
  type AnalyzeRequest,
  type ElderState,
  type IngestRequest,
  type Level,
  type Tactic,
  type Utterance,
  type Verification,
} from '../../../contracts/index.js';

export const WINDOW_MS = 60_000;
const MAX_UTTERANCES = 400;
const MAX_TEXT = 1_000;
const MAX_WINDOW_LINES = 40;

/** What the model returns (after parsing and cleaning). */
export interface ModelVerdict {
  risk: number;
  tactics: Tactic[];
  reason: string;
  claimedRelative: boolean;
  elderState: ElderState;
}

export interface Decision {
  level: Level;
  risk: number;
  tactics: Tactic[];
  action: Action;
  calmStreak: number;
  shouldAlert: boolean;
}

type DecideInput = Pick<AnalyzeRequest, 'prevLevel' | 'calmStreak' | 'verification' | 'familyAlerted' | 'agentStatus'>;

const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };
const elderRank: Record<ElderState, number> = { none: 0, engaging: 1, complying: 2 };
/** Who the caller claims to be and time pressure only set the scene: real family emergencies have both. */
const SCENE_TACTICS: Tactic[] = ['impersonation', 'urgency'];

/** Last ~60 s of transcript, measured back from the newest sentence. */
export function recentWindow(utterances: Utterance[]): Utterance[] {
  if (utterances.length === 0) return [];
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  const newest = sorted[sorted.length - 1].ts;
  return sorted.filter((u) => u.ts >= newest - WINDOW_MS).slice(-MAX_WINDOW_LINES);
}

/**
 * Our rules on top of the model's verdict:
 * - red needs 2+ tactics (plus high risk), at least one of them an ask,
 *   secrecy or a threat (not just impersonation + urgency), or a failed
 *   verification after a claimed relative.
 * - a passed verification removes "impersonation" (the relative is real).
 * - if the agent verified the caller, the call can't go red again.
 * - the level only drops after two calm results in a row.
 * - the family is alerted once, when the call is red and the elder starts
 *   falling for it (engaging or complying).
 * - the agent takes over once, when the call is red and the elder is clearly
 *   complying.
 */
export function decide(v: ModelVerdict, req: DecideInput): Decision {
  let tactics = [...v.tactics];
  let risk = v.risk;
  const agentVerified = req.agentStatus === 'verified';

  if (req.verification === 'passed' || agentVerified) {
    tactics = tactics.filter((t) => t !== 'impersonation');
    risk = Math.min(risk, tactics.length >= 2 ? risk : 35);
  }

  let candidate: Level = 'green';
  if (tactics.length >= 2 && risk >= 60 && tactics.some((t) => !SCENE_TACTICS.includes(t))) candidate = 'red';
  else if (tactics.length >= 1 || risk >= 40) candidate = 'yellow';

  if (req.verification === 'failed' && v.claimedRelative && tactics.length >= 1) {
    candidate = 'red';
    risk = Math.max(risk, 85);
  }

  if (agentVerified && candidate === 'red') {
    candidate = 'yellow';
    risk = Math.min(risk, 55);
  }

  const calmStreak = candidate === 'green' ? req.calmStreak + 1 : 0;

  let level = candidate;
  // Hysteresis, except right after the agent verified the caller.
  if (rank[candidate] < rank[req.prevLevel] && calmStreak < 2 && !agentVerified) level = req.prevLevel;

  const falling = elderRank[v.elderState] >= elderRank.engaging;
  const shouldAlert = level === 'red' && falling && !req.familyAlerted;
  const takeover = level === 'red' && v.elderState === 'complying' && req.agentStatus === 'idle';

  let action: Action = 'none';
  if (takeover) action = 'agent_takeover';
  else if (shouldAlert) action = 'alert_family';
  else if (level === 'yellow' && v.claimedRelative && req.verification === 'unasked' && req.agentStatus === 'idle') {
    action = 'ask_verification';
  }

  return { level, risk, tactics, action, calmStreak, shouldAlert };
}

/** Pull the first JSON object out of model text. */
export function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model returned no JSON');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/** Parse the model's text into a clean verdict. Unknown tactics are dropped. */
export function parseVerdict(text: string): ModelVerdict {
  const raw = extractJson(text);
  const risk = Math.round(Math.min(100, Math.max(0, Number(raw.risk) || 0)));
  const tactics = Array.isArray(raw.tactics)
    ? [...new Set(raw.tactics.filter((t): t is Tactic => (TACTICS as readonly string[]).includes(t as string)))]
    : [];
  const elderState = (ELDER_STATES as readonly string[]).includes(raw.elderState as string)
    ? (raw.elderState as ElderState)
    : 'none';
  return {
    risk,
    tactics,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '',
    claimedRelative: raw.claimedRelative === true,
    elderState,
  };
}

export class BadRequest extends Error {}

/** Validate the transcript part of a request (shared by both Lambdas). */
export function parseUtterances(b: Record<string, unknown>): { callId: string; elderId: string; utterances: Utterance[] } {
  const str = (k: string, max = 64) => {
    const v = b[k];
    if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new BadRequest(`${k} must be a string`);
    return v;
  };
  const callId = str('callId');
  const elderId = str('elderId');

  if (!Array.isArray(b.utterances) || b.utterances.length > MAX_UTTERANCES) {
    throw new BadRequest(`utterances must be an array of at most ${MAX_UTTERANCES}`);
  }
  const utterances: Utterance[] = b.utterances.map((u, i) => {
    const o = (u ?? {}) as Record<string, unknown>;
    if (typeof o.text !== 'string') throw new BadRequest(`utterances[${i}].text must be a string`);
    return {
      callId,
      elderId,
      speaker: typeof o.speaker === 'string' ? o.speaker.slice(0, 32) : 'unknown',
      text: o.text.slice(0, MAX_TEXT),
      ts: Number.isFinite(o.ts) ? Number(o.ts) : Date.now(),
      seq: Number.isFinite(o.seq) ? Number(o.seq) : i,
    };
  });
  return { callId, elderId, utterances };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

/** Validate the request at the trust boundary (the function URL is public). */
export function parseRequest(body: unknown): AnalyzeRequest {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const { callId, elderId, utterances } = parseUtterances(b);
  return {
    callId,
    elderId,
    utterances,
    prevLevel: oneOf<Level>(LEVELS, b.prevLevel, 'green'),
    verification: oneOf<Verification>(VERIFICATIONS, b.verification, 'unasked'),
    agentStatus: oneOf<AgentStatus>(AGENT_STATUSES, b.agentStatus, 'idle'),
    familyAlerted: b.familyAlerted === true,
    calmStreak: Number.isInteger(b.calmStreak) ? Math.max(0, Math.min(10, Number(b.calmStreak))) : 0,
  };
}

/** Validate one sentence from the phone transcriber (IngestFn is invoked directly, not over HTTP). */
export function parseIngest(body: unknown): Required<IngestRequest> {
  if (!body || typeof body !== 'object') throw new BadRequest('event must be an IngestRequest object');
  const b = body as Record<string, unknown>;
  if (b.speaker !== 'caller' && b.speaker !== 'elder') throw new BadRequest('speaker must be "caller" or "elder"');
  const [u] = parseUtterances({ ...b, utterances: [b] }).utterances;
  if (!u.text.trim()) throw new BadRequest('text must not be empty');
  return { callId: u.callId, elderId: u.elderId, speaker: b.speaker, text: u.text, ts: u.ts };
}
