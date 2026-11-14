import type { AnalyzeRequest, Level, RiskState, Utterance, Verification } from '../../contracts/index.js';
import { TEST_SCRIPTS } from '../../backend/scripts/test-scripts.js';
import { startTranscriber } from './transcribe.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LABEL: Record<Level, string> = { green: 'Safe', yellow: 'Careful', red: 'Scam!' };

// All call state lives in the browser in Stage 1 and goes along with each request.
let callId = '';
let utterances: Utterance[] = [];
let level: Level = 'green';
let calmStreak = 0;
let verification: Verification = 'unasked';
let stopFn: (() => void) | null = null;
let inFlight: Promise<void> = Promise.resolve();
let partialEl: HTMLLIElement | null = null;

for (const s of TEST_SCRIPTS) $('demo-script').append(new Option(s.name, s.name));
$<HTMLInputElement>('demo').onchange = (e) => ($('demo-script').hidden = !(e.target as HTMLInputElement).checked);

$('start').onclick = async () => {
  reset();
  $('start').hidden = true;
  $('stop').hidden = false;
  try {
    if ($<HTMLInputElement>('demo').checked) await playDemo($<HTMLSelectElement>('demo-script').value);
    else {
      status('Connecting…');
      stopFn = await startTranscriber({
        onPartial: (t) => showPartial(t),
        onFinal: (t) => addSentence(t),
        onError: (err) => status(`Transcribe error: ${String(err)}`),
      });
      status('Listening. Put the call on speaker next to this device.');
    }
  } catch (err) {
    status(`Could not start: ${String(err)}`);
    stop();
  }
};
$('stop').onclick = () => stop();

$('verify-yes').onclick = () => answerVerification('passed');
$('verify-no').onclick = () => answerVerification('failed');

function reset() {
  callId = `c-${crypto.randomUUID().slice(0, 8)}`;
  utterances = [];
  level = 'green';
  calmStreak = 0;
  verification = 'unasked';
  $('transcript').replaceChildren();
  $('verify').hidden = true;
  $('alerted').hidden = true;
  render({ callId, risk: 0, level: 'green', tactics: [], reason: '', action: 'none', updatedAt: 0, calmStreak: 0, claimedRelative: false, familyAlerted: false });
}

function stop() {
  stopFn?.();
  stopFn = null;
  $('start').hidden = false;
  $('stop').hidden = true;
  status('Stopped. Nothing was saved.');
}

function showPartial(text: string) {
  if (!partialEl) {
    partialEl = document.createElement('li');
    partialEl.className = 'partial';
    $('transcript').append(partialEl);
  }
  partialEl.textContent = text;
}

function addSentence(text: string) {
  partialEl?.remove();
  partialEl = null;
  const li = document.createElement('li');
  li.textContent = text;
  $('transcript').append(li);
  utterances.push({ callId, elderId: 'e-01', speaker: 'caller', text, ts: Date.now(), seq: utterances.length });
  // Serialize requests so each one carries the previous level.
  inFlight = inFlight.then(analyze);
}

async function analyze() {
  const body: AnalyzeRequest = { callId, elderId: 'e-01', utterances, prevLevel: level, calmStreak, verification };
  const t0 = performance.now();
  try {
    const res = await fetch(import.meta.env.VITE_ANALYZE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = (await res.json()) as RiskState;
    level = s.level;
    calmStreak = s.calmStreak;
    render(s);
    status(`Checked in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    // Keep showing the last level while waiting.
    status(`Check failed (${String(err)}), keeping last result`);
  }
}

function render(s: RiskState) {
  $('light').className = `light ${s.level}`;
  $('level').textContent = LABEL[s.level];
  $('meter-fill').style.width = `${s.risk}%`;
  $('reason').textContent = s.reason;
  $('tactics').replaceChildren(
    ...s.tactics.map((t) => Object.assign(document.createElement('span'), { textContent: t.replaceAll('_', ' ') })),
  );
  if (s.action === 'ask_verification' && s.verificationQuestion) {
    $('verify-q').textContent = s.verificationQuestion;
    $('verify').hidden = false;
  }
  if (s.familyAlerted) $('alerted').hidden = false;
}

function answerVerification(v: Verification) {
  verification = v;
  $('verify').hidden = true;
  // Re-score now with the answer instead of waiting for the next sentence.
  if (utterances.length) inFlight = inFlight.then(analyze);
}

async function playDemo(name: string) {
  const script = TEST_SCRIPTS.find((s) => s.name === name)!;
  status(`Playing ${name}`);
  for (const line of script.lines) {
    if (!$('start').hidden) return; // stopped
    addSentence(line);
    await inFlight;
    await new Promise((r) => setTimeout(r, 1500));
  }
  status(`Finished ${name}`);
}

function status(text: string) {
  $('status').textContent = text;
}
