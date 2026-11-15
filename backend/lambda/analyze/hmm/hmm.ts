// Phrase extraction + switching-HMM forward filter. A TypeScript port of
// ml/hmm/extract.py (phrase unit) and ml/hmm/hmm_model.py (SwitchingHMM.filter);
// model.json is exported by ml/hmm/run.py. Runs in well under a millisecond per
// call, so it is recomputed over the whole transcript on every request.
import type { Tactic, Utterance } from '../../../../contracts/index.js';
import { ASK_CATEGORIES, CALLER_RE, NEGATION, NEGATION_WINDOW_CHARS, RECEIVER_RE, SYMBOLS } from './lexicon.js';
import model from './model.json' with { type: 'json' };

export interface Phrase {
  category: string;
  text: string;
  start: number;
  negated?: boolean;
}

export interface HmmResult {
  /** P(the call is in a scam phase | everything said so far), 0..1. */
  pScam: number;
  /** pScam after each observation (for debugging and tests). */
  trace: number[];
  /** Caller tactic categories heard (negated asks excluded), whole call. */
  categories: Set<string>;
  /** Caller tactics mapped to the contract's names, for when Haiku is unavailable. */
  tactics: Tactic[];
  claimedRelative: boolean;
  /** The receiver said something compliant ("here it is", reading digits). */
  receiverComplied: boolean;
}

if (JSON.stringify(model.symbols) !== JSON.stringify(SYMBOLS)) {
  throw new Error('hmm/model.json was trained with a different lexicon than hmm/lexicon.ts');
}
const SYM_ID = new Map(SYMBOLS.map((s, i) => [s, i]));
const K = model.start.length;

export function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.?!;:])/g, '$1')
    .trim();
}

/** Who said it: the elder answers ("R"), the agent's own lines are skipped, anyone else is the caller. */
export function roleOf(speaker: string): 'C' | 'R' | null {
  if (speaker === 'agent') return null;
  return speaker === 'elder' ? 'R' : 'C';
}

function negated(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - NEGATION_WINDOW_CHARS), start).split(/[.?!;]/).pop() ?? '';
  return NEGATION.test(before);
}

/** Non-overlapping phrase matches; at the same position the earlier lexicon category wins. */
export function extract(role: 'C' | 'R', text: string): Phrase[] {
  const table = role === 'C' ? CALLER_RE : RECEIVER_RE;
  const found: { start: number; rank: number; end: number; category: string; text: string }[] = [];
  table.forEach(([category, rx], rank) => {
    for (const m of text.matchAll(rx)) found.push({ start: m.index!, rank, end: m.index! + m[0].length, category, text: m[0] });
  });
  found.sort((a, b) => a.start - b.start || a.rank - b.rank || a.end - b.end);
  const kept: Phrase[] = [];
  let lastEnd = -1;
  for (const f of found) {
    if (f.start < lastEnd) continue;
    const p: Phrase = { category: f.category, text: f.text, start: f.start };
    if (role === 'C' && ASK_CATEGORIES.has(f.category) && negated(text, f.start)) p.negated = true;
    kept.push(p);
    lastEnd = f.end;
  }
  return kept;
}

/** Observation symbols for the call, one per matched phrase (repeats in a turn collapsed). */
export function symbolsOf(utterances: Utterance[]): { obs: number[]; phrases: { role: 'C' | 'R'; phrases: Phrase[] }[] } {
  const obs: number[] = [];
  const phrases: { role: 'C' | 'R'; phrases: Phrase[] }[] = [];
  for (const u of [...utterances].sort((a, b) => a.seq - b.seq)) {
    const role = roleOf(u.speaker);
    const text = normalize(u.text);
    if (!role || !text) continue;
    const ps = extract(role, text);
    phrases.push({ role, phrases: ps });
    const cats: string[] = [];
    for (const p of ps) {
      const c = p.negated ? 'NEGATED' : p.category;
      if (cats[cats.length - 1] !== c) cats.push(c);
    }
    for (const c of cats.length ? cats : ['NONE']) obs.push(SYM_ID.get(`${role}:${c}`)!);
  }
  return { obs, phrases };
}

/** Normalized forward recursion over the switching HMM; P(scam block) after each symbol. */
export function filter(obs: number[]): number[] {
  const out: number[] = [];
  let alpha = model.start.map((p, i) => p * model.emis[i][obs[0]]);
  for (let t = 0; t < obs.length; t++) {
    if (t > 0) {
      const next = new Array<number>(K).fill(0);
      for (let i = 0; i < K; i++) {
        if (alpha[i] === 0) continue;
        const row = model.trans[i];
        for (let j = 0; j < K; j++) next[j] += alpha[i] * row[j];
      }
      alpha = next.map((a, j) => a * model.emis[j][obs[t]]);
    }
    const z = alpha.reduce((a, b) => a + b, 0);
    alpha = alpha.map((a) => a / z);
    out.push(alpha.slice(model.nNormal).reduce((a, b) => a + b, 0));
  }
  return out;
}

const TACTIC_OF: Record<string, Tactic> = {
  INFO: 'personal_info_request',
  GIFT: 'gift_cards',
  PAY: 'payment_request',
  REMOTE: 'remote_access',
  THREAT: 'threats',
  SECRECY: 'secrecy',
  URGENCY: 'urgency',
  IMPERSONATE: 'impersonation',
};
const WIRE = /wire|bitcoin|crypto|western union|moneygram|zelle|venmo|cash ?app/i;

export function scoreHmm(utterances: Utterance[]): HmmResult {
  const { obs, phrases } = symbolsOf(utterances);
  const trace = obs.length ? filter(obs) : [];
  const categories = new Set<string>();
  const tactics = new Set<Tactic>();
  let receiverComplied = false;
  for (const turn of phrases) {
    for (const p of turn.phrases) {
      if (turn.role === 'R') {
        if (p.category === 'COMPLY') receiverComplied = true;
        continue;
      }
      if (p.negated) continue;
      categories.add(p.category);
      if (p.category === 'PAY' && WIRE.test(p.text)) tactics.add('wire_or_crypto');
      else if (TACTIC_OF[p.category]) tactics.add(TACTIC_OF[p.category]);
    }
  }
  return {
    pScam: trace.length ? trace[trace.length - 1] : 0,
    trace,
    categories,
    tactics: [...tactics],
    claimedRelative: categories.has('RELATIVE'),
    receiverComplied,
  };
}

/** The validation threshold the model was exported with (P(scam) for <=5% false alarms). */
export const HMM_THRESHOLD: number = model.threshold;
