// Pure level rules. No AWS calls here so they can be unit tested.
import {
  LEVELS,
  TACTICS,
  VERIFICATIONS,
  type Action,
  type AnalyzeRequest,
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
}

export interface Decision {
  level: Level;
  risk: number;
  tactics: Tactic[];
  action: Action;
  calmStreak: number;
  shouldAlert: boolean;
}

const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

/** Last ~60 s of transcript, measured back from the newest sentence. */
export function recentWindow(utterances: Utterance[]): Utterance[] {
  if (utterances.length === 0) return [];
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  const newest = sorted[sorted.length - 1].ts;
  return sorted.filter((u) => u.ts >= newest - WINDOW_MS).slice(-MAX_WINDOW_LINES);
}

/**
 * Our rules on top of the model's verdict:
 * - red needs 2+ tactics (plus high risk), or a failed verification after a
 *   claimed relative.
 * - a passed verification removes "impersonation" (the relative is real).
 * - the level only drops after two calm results in a row.
 * - the family is texted only on the transition into red.
 */
export function decide(v: ModelVerdict, req: Pick<AnalyzeRequest, 'prevLevel' | 'calmStreak' | 'verification'>): Decision {
  let tactics = [...v.tactics];
  let risk = v.risk;

  if (req.verification === 'passed') {
    tactics = tactics.filter((t) => t !== 'impersonation');
    risk = Math.min(risk, tactics.length >= 2 ? risk : 35);
  }

  let candidate: Level = 'green';
  if (tactics.length >= 2 && risk >= 60) candidate = 'red';
  else if (tactics.length >= 1 || risk >= 40) candidate = 'yellow';

  if (req.verification === 'failed' && v.claimedRelative && tactics.length >= 1) {
    candidate = 'red';
    risk = Math.max(risk, 85);
  }

  const calmStreak = candidate === 'green' ? req.calmStreak + 1 : 0;

  let level = candidate;
  if (rank[candidate] < rank[req.prevLevel] && calmStreak < 2) level = req.prevLevel;

  let action: Action = 'none';
  if (level === 'red') action = 'alert_family';
  else if (level === 'yellow' && v.claimedRelative && req.verification === 'unasked') action = 'ask_verification';

  return {
    level,
    risk,
    tactics,
    action,
    calmStreak,
    shouldAlert: level === 'red' && req.prevLevel !== 'red',
  };
}

/** Parse the model's text into a clean verdict. Unknown tactics are dropped. */
export function parseVerdict(text: string): ModelVerdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model returned no JSON');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const risk = Math.round(Math.min(100, Math.max(0, Number(raw.risk) || 0)));
  const tactics = Array.isArray(raw.tactics)
    ? [...new Set(raw.tactics.filter((t): t is Tactic => (TACTICS as readonly string[]).includes(t as string)))]
    : [];
  return {
    risk,
    tactics,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '',
    claimedRelative: raw.claimedRelative === true,
  };
}

export class BadRequest extends Error {}

/** Validate the request at the trust boundary (the function URL is public). */
export function parseRequest(body: unknown): AnalyzeRequest {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
  const b = body as Record<string, unknown>;
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

  const prevLevel = (LEVELS as readonly string[]).includes(b.prevLevel as string) ? (b.prevLevel as Level) : 'green';
  const verification = (VERIFICATIONS as readonly string[]).includes(b.verification as string)
    ? (b.verification as Verification)
    : 'unasked';
  const calmStreak = Number.isInteger(b.calmStreak) ? Math.max(0, Math.min(10, Number(b.calmStreak))) : 0;

  return { callId, elderId, utterances, prevLevel, calmStreak, verification };
}
