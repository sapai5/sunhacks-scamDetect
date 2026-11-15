// Long-context eval for the scam classifier (Haiku on Bedrock), using the
// production prompt, parser and level rules.
//
// Experiment "needle": the model alone, no 60 s window. A scam conversation is
// buried in benign small talk at growing lengths (≈1k → 150k tokens) and at
// different positions (start, middle, end, scattered across the call). Benign
// calls get the same padding to catch false positives. Answers: does Haiku
// itself degrade with long input?
//
// Experiment "pipeline": what production actually does. A slow-burn call where
// the scam lines are spread over several minutes, scored after every sentence
// with carried state. Compares the production 60 s / 40-line window with
// sending the whole transcript. Answers: does the window make us miss
// slow-burn scams?
//
// Usage (from backend/):
//   npx tsx scripts/long-context-eval.ts --dry-run          # plan + token estimate, no calls
//   npx tsx scripts/long-context-eval.ts                    # both experiments
//   npx tsx scripts/long-context-eval.ts --exp needle --lengths 1000,32000 --reps 2
// Auth: default AWS credential chain (set AWS_PROFILE to pick a profile).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Level, Utterance } from '../../contracts/index.js';
import { buildUserMessage, SYSTEM_PROMPT } from '../lambda/analyze/prompt.js';
import { decide, parseVerdict, recentWindow, type ModelVerdict } from '../lambda/analyze/rules.js';
import { TEST_SCRIPTS, type Line } from './test-scripts.js';

// ---------------------------------------------------------------- args/config
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ctx = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')).context;
const MODEL_ID = opt('model', ctx.modelId);
const REGION = opt('region', ctx.region ?? 'us-east-1');
const ELDER = ctx.elderName ?? 'Rose';
const DRY = flag('dry-run');
const EXP = opt('exp', 'all');
const REPS = Number(opt('reps', '1'));
const LENGTHS = opt('lengths', '1000,8000,32000,96000,150000').split(',').map(Number);
const CONCURRENCY = Number(opt('concurrency', '2'));
const PIPELINE_MINUTES = Number(opt('minutes', '8'));

const bedrock = new BedrockRuntimeClient({ region: REGION, maxAttempts: 8 });

// ---------------------------------------------------------------- filler
// Seeded RNG so every run builds the same transcripts.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const PEOPLE = ['Linda', 'Frank', 'Dorothy', 'Pastor Jim', 'Mrs. Alvarez', 'Uncle Ray', 'the Hendersons', 'Betty from bridge club'];
const PLACES = ['the garden', 'the senior center', 'church', 'the farmers market', 'the library', 'the park', 'the diner on Fifth'];
const THINGS = ['tomatoes', 'the quilt', 'that crossword', 'the new recliner', 'the bird feeder', 'my reading glasses', 'the photo album', 'the casserole dish'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TOPICS = ['the weather', 'the ball game', 'the news', 'the book club pick', 'the holiday plans', 'the neighbor\'s dog'];

const CALLER_SMALLTALK = [
  () => `How have you been feeling since ${pick(r0, DAYS)}?`,
  () => `Did you ever get ${pick(r0, THINGS)} sorted out?`,
  () => `I heard ${pick(r0, PEOPLE)} was asking about you at ${pick(r0, PLACES)}.`,
  () => `What do you think about ${pick(r0, TOPICS)} this week?`,
  () => `It's been so long since we really talked, I just wanted to catch up.`,
  () => `Tell me more about ${pick(r0, PEOPLE)}, I always liked hearing about them.`,
  () => `Are you still going to ${pick(r0, PLACES)} on ${pick(r0, DAYS)}s?`,
  () => `That reminds me, how are ${pick(r0, THINGS)} coming along?`,
];
const ELDER_SMALLTALK = [
  () => `Oh, I've been alright. My knee acts up when it rains but I can't complain.`,
  () => `${pick(r0, PEOPLE)} came by on ${pick(r0, DAYS)} and we sat out by ${pick(r0, PLACES)} for a while.`,
  () => `I finally found ${pick(r0, THINGS)}, it was in the hall closet the whole time.`,
  () => `You know how ${pick(r0, TOPICS)} goes, everybody has an opinion.`,
  () => `We had the potluck at ${pick(r0, PLACES)} and I brought my lemon bars.`,
  () => `I've been watching the birds every morning, there's a cardinal that comes by.`,
  () => `My granddaughter sent pictures from her trip, I put them on the fridge.`,
  () => `I keep meaning to call ${pick(r0, PEOPLE)} but the days just get away from me.`,
  // Hard negatives: money and banks mentioned in an ordinary way.
  () => `I paid the water bill at the bank on ${pick(r0, DAYS)}, the teller was very nice.`,
  () => `The pharmacy said my copay went up to fifteen dollars, can you believe it.`,
  () => `I put a little in the collection plate at ${pick(r0, PLACES)} like always.`,
];
let r0 = rng(1);

/** About `targetTokens` of benign two-speaker small talk (~4 chars per token). */
function filler(targetTokens: number, seed: number): Line[] {
  r0 = rng(seed);
  const out: Line[] = [];
  let chars = 0;
  while (chars / 4 < targetTokens) {
    const caller = { speaker: 'caller' as const, text: pick(r0, CALLER_SMALLTALK)() };
    const elder = { speaker: 'elder' as const, text: pick(r0, ELDER_SMALLTALK)() };
    out.push(caller, elder);
    chars += caller.text.length + elder.text.length + 20;
  }
  return out;
}

type Placement = 'end' | 'middle' | 'start' | 'scattered';

function embed(core: Line[], pad: Line[], where: Placement): Line[] {
  if (where === 'end') return [...pad, ...core];
  if (where === 'start') return [...core, ...pad];
  if (where === 'middle') {
    const mid = Math.floor(pad.length / 2);
    return [...pad.slice(0, mid), ...core, ...pad.slice(mid)];
  }
  // scattered: core lines spread evenly through the padding, still in order, last one at the end
  const out: Line[] = [];
  const gap = Math.floor(pad.length / core.length);
  core.forEach((line, i) => out.push(...pad.slice(i * gap, (i + 1) * gap), line));
  return out;
}

// Production diarization labels (spk_0 = caller, spk_1 = elder).
const toUtterances = (lines: Line[], callId: string, secondsApart = 4): Utterance[] =>
  lines.map((l, i) => ({
    callId,
    elderId: 'eval',
    speaker: l.speaker === 'caller' ? 'spk_0' : 'spk_1',
    text: l.text,
    ts: 1_700_000_000_000 + i * secondsApart * 1000,
    seq: i,
  }));

// ---------------------------------------------------------------- model call
interface Scored {
  verdict: ModelVerdict | null;
  raw: string;
  inputTokens: number;
  ms: number;
  error?: string;
}

const estTokens = (window: Utterance[]) => Math.round((SYSTEM_PROMPT.length + buildUserMessage(ELDER, window).length) / 4);
let spentIn = 0;
let spentOut = 0;

async function scoreWindow(window: Utterance[]): Promise<Scored> {
  const t0 = Date.now();
  try {
    const res = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 200,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage(ELDER, window) }],
        }),
      }),
    );
    const body = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const raw = body.content?.find((c) => c.type === 'text')?.text ?? '';
    spentIn += body.usage?.input_tokens ?? 0;
    spentOut += body.usage?.output_tokens ?? 0;
    let verdict: ModelVerdict | null = null;
    let error: string | undefined;
    try {
      verdict = parseVerdict(raw);
    } catch (e) {
      error = `parse: ${(e as Error).message}`;
    }
    return { verdict, raw, inputTokens: body.usage?.input_tokens ?? 0, ms: Date.now() - t0, error };
  } catch (e) {
    return { verdict: null, raw: '', inputTokens: 0, ms: Date.now() - t0, error: (e as Error).name + ': ' + (e as Error).message };
  }
}

const freshState = { prevLevel: 'green' as Level, calmStreak: 0, verification: 'unasked' as const, familyAlerted: false, agentStatus: 'idle' as const };
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- experiment: needle
const SCAMS = TEST_SCRIPTS.filter((s) => ['grandparent-scam', 'tech-support-scam'].includes(s.name));
const BENIGN = TEST_SCRIPTS.filter((s) => ['grandkid-hi-legit', 'bank-reminder-legit'].includes(s.name));

interface NeedleCase {
  script: string;
  scam: boolean;
  expectedPeak: Level;
  placement: Placement;
  targetTokens: number;
  rep: number;
  utterances: Utterance[];
}

function needleCases(): NeedleCase[] {
  const cases: NeedleCase[] = [];
  for (const target of LENGTHS) {
    for (let rep = 0; rep < REPS; rep++) {
      for (const s of SCAMS) {
        for (const placement of ['end', 'middle', 'start', 'scattered'] as Placement[]) {
          const lines = embed(s.lines, filler(target, 100 + rep), placement);
          cases.push({ script: s.name, scam: true, expectedPeak: 'red', placement, targetTokens: target, rep, utterances: toUtterances(lines, `n-${s.name}`) });
        }
      }
      for (const s of BENIGN) {
        const lines = embed(s.lines, filler(target, 200 + rep), 'end');
        cases.push({ script: s.name, scam: false, expectedPeak: s.expectedPeak, placement: 'end', targetTokens: target, rep, utterances: toUtterances(lines, `n-${s.name}`) });
      }
    }
  }
  return cases;
}

async function runNeedle() {
  const cases = needleCases();
  const est = cases.reduce((a, c) => a + estTokens(c.utterances), 0);
  console.log(`\n== needle: ${cases.length} calls, ~${(est / 1e6).toFixed(2)}M input tokens (est.)`);
  if (DRY) return { cases: cases.map(({ utterances, ...c }) => ({ ...c, lines: utterances.length, estTokens: estTokens(utterances) })) };

  const results = await pool(cases, CONCURRENCY, async (c) => {
    const s = await scoreWindow(c.utterances);
    const level = s.verdict ? decide(s.verdict, freshState).level : null;
    const pass = level !== null && (c.scam ? level === 'red' : rank[level] <= rank[c.expectedPeak]);
    const row = { ...c, utterances: undefined, lines: c.utterances.length, level, pass, risk: s.verdict?.risk ?? null, tactics: s.verdict?.tactics ?? [], reason: s.verdict?.reason ?? '', inputTokens: s.inputTokens, ms: s.ms, error: s.error };
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${c.script.padEnd(20)} ${c.placement.padEnd(9)} ${String(s.inputTokens || estTokens(c.utterances)).padStart(7)} tok  ${String(level).padEnd(6)} risk ${String(row.risk).padStart(3)}  ${String(s.ms).padStart(6)} ms  ${row.tactics.join(',')}${s.error ? '  ERR ' + s.error : ''}`,
    );
    return row;
  });

  // Summary: pass rate by length × group.
  console.log('\nneedle summary (pass / total)');
  const groups: [string, (r: (typeof results)[number]) => boolean][] = [
    ['scam@end', (r) => r.scam && r.placement === 'end'],
    ['scam@middle', (r) => r.scam && r.placement === 'middle'],
    ['scam@start', (r) => r.scam && r.placement === 'start'],
    ['scam@scattered', (r) => r.scam && r.placement === 'scattered'],
    ['benign', (r) => !r.scam],
  ];
  console.log('target tok'.padEnd(12) + groups.map(([g]) => g.padStart(16)).join('') + '   median ms');
  for (const t of LENGTHS) {
    const atLen = results.filter((r) => r.targetTokens === t);
    const cells = groups.map(([, f]) => {
      const g = atLen.filter(f);
      return `${g.filter((r) => r.pass).length}/${g.length}`.padStart(16);
    });
    const ms = atLen.map((r) => r.ms).sort((a, b) => a - b);
    console.log(String(t).padEnd(12) + cells.join('') + String(ms[Math.floor(ms.length / 2)] ?? '').padStart(12));
  }
  return { results };
}

// ---------------------------------------------------------------- experiment: pipeline
/**
 * A slow-burn call: ~`minutes` long, one sentence every 4 s, with the scam
 * lines spaced out evenly so no 60 s window holds more than one or two of them.
 */
function slowBurn(script: (typeof TEST_SCRIPTS)[number], minutes: number, seed: number): Utterance[] {
  const totalLines = Math.round((minutes * 60) / 4);
  const pad = filler(totalLines * 12, seed).slice(0, totalLines - script.lines.length);
  return toUtterances(embed(script.lines, pad, 'scattered'), `p-${script.name}`);
}

async function runPipeline() {
  const scripts = [...SCAMS, ...BENIGN];
  const modes = ['window', 'full'] as const;
  const calls = scripts.map((s, i) => ({ s, utterances: slowBurn(s, PIPELINE_MINUTES, 300 + i) }));
  let est = 0;
  for (const { utterances } of calls)
    for (let n = 1; n <= utterances.length; n++) {
      est += estTokens(recentWindow(utterances.slice(0, n))) + estTokens(utterances.slice(0, n));
    }
  console.log(`\n== pipeline: ${calls.length} calls × ${calls[0].utterances.length} sentences × 2 modes, ~${(est / 1e6).toFixed(2)}M input tokens (est.)`);
  if (DRY) return { calls: calls.map((c) => ({ script: c.s.name, sentences: c.utterances.length })) };

  const jobs = calls.flatMap((c) => modes.map((mode) => ({ ...c, mode })));
  const results = await pool(jobs, CONCURRENCY, async ({ s, utterances, mode }) => {
    let state = { ...freshState };
    let peak: Level = 'green';
    let firstRedAt: number | null = null;
    let errors = 0;
    const errorSamples = new Set<string>();
    const trace: { n: number; level: Level; risk: number; tactics: string[] }[] = [];
    for (let n = 1; n <= utterances.length; n++) {
      const sofar = utterances.slice(0, n);
      const window = mode === 'window' ? recentWindow(sofar) : sofar;
      const r = await scoreWindow(window);
      if (!r.verdict) {
        errors++;
        errorSamples.add(r.error ?? 'unknown');
        continue; // production keeps the last level on failure
      }
      const d = decide(r.verdict, state);
      state = { ...state, prevLevel: d.level, calmStreak: d.calmStreak, familyAlerted: state.familyAlerted || d.shouldAlert };
      if (rank[d.level] > rank[peak]) peak = d.level;
      if (d.level === 'red' && firstRedAt === null) firstRedAt = n;
      trace.push({ n, level: d.level, risk: d.risk, tactics: d.tactics });
    }
    const scam = SCAMS.includes(s);
    const pass = scam ? peak === 'red' : rank[peak] <= rank[s.expectedPeak];
    const scamIdx = utterances.flatMap((u, i) => (s.lines.some((l) => l.text === u.text) ? [i + 1] : []));
    const lastScamLine = scamIdx[scamIdx.length - 1] ?? 0;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${s.name.padEnd(20)} ${mode.padEnd(6)} peak ${peak.padEnd(6)} first red at ${firstRedAt ?? '-'} / ${utterances.length} (last scam line ${lastScamLine})${errors ? `  ${errors} errors: ${[...errorSamples].map((e) => e.slice(0, 160)).join(' | ')}` : ''}`,
    );
    return { script: s.name, mode, scam, pass, peak, firstRedAt, sentences: utterances.length, lastScamLine, errors, errorSamples: [...errorSamples], trace };
  });
  return { results };
}

// ---------------------------------------------------------------- main
console.log(`model ${MODEL_ID}  region ${REGION}  lengths ${LENGTHS.join(',')}  reps ${REPS}${DRY ? '  (dry run)' : ''}`);
const out: Record<string, unknown> = { model: MODEL_ID, region: REGION, at: new Date().toISOString(), lengths: LENGTHS, reps: REPS };
if (EXP === 'all' || EXP === 'needle') out.needle = await runNeedle();
if (EXP === 'all' || EXP === 'pipeline') out.pipeline = await runPipeline();
if (!DRY) {
  out.usage = { inputTokens: spentIn, outputTokens: spentOut };
  console.log(`\nused ${spentIn.toLocaleString()} input + ${spentOut.toLocaleString()} output tokens`);
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  const file = new URL(`./out/long-context-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${file.pathname}`);
}
