import type {
  AgentResponse,
  AgentStatus,
  AnalyzeRequest,
  Level,
  RiskState,
  Utterance,
  Verification,
} from '../../contracts/index.js';
import { TEST_SCRIPTS, type TestScript } from '../../backend/scripts/test-scripts.js';
import { speak, stopSpeaking, unlockSpeech } from './speech.js';
import { startTranscriber, type Transcriber } from './transcribe.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LABEL: Record<Level, string> = { green: 'Safe', yellow: 'Careful', red: 'Scam!' };
/** Wait this long after the caller's last sentence before the agent answers. */
const AGENT_REPLY_DELAY_MS = 1200;
/** If the caller says nothing for this long after the agent speaks, treat them as gone. */
const CALLER_SILENCE_MS = 25_000;

// All call state lives in the browser in Stage 1 and goes along with each request.
let callId = '';
let utterances: Utterance[] = [];
let level: Level = 'green';
let calmStreak = 0;
let verification: Verification = 'unasked';
let familyAlerted = false;
let agentStatus: AgentStatus = 'idle';
let transcriber: Transcriber | null = null;
let demo: { script: TestScript; replies: string[] } | null = null;
let running = false;
let inFlight: Promise<void> = Promise.resolve();
let partialEl: HTMLLIElement | null = null;
let agentTimer: ReturnType<typeof setTimeout> | undefined;
let silenceTimer: ReturnType<typeof setTimeout> | undefined;
let agentBusy = false;

for (const s of TEST_SCRIPTS) $('demo-script').append(new Option(s.name, s.name));
$<HTMLInputElement>('demo').onchange = (e) => ($('demo-script').hidden = !(e.target as HTMLInputElement).checked);

$('start').onclick = async () => {
  unlockSpeech();
  reset();
  running = true;
  $('start').hidden = true;
  $('stop').hidden = false;
  try {
    if ($<HTMLInputElement>('demo').checked) await playDemo($<HTMLSelectElement>('demo-script').value);
    else {
      status('Connecting…');
      transcriber = await startTranscriber({
        onPartial: (t) => showPartial(t),
        onFinal: (t, speaker) => addSentence(t, speaker),
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
$('agent-stop').onclick = () => finishAgent('stopped', '');

function reset() {
  callId = `c-${crypto.randomUUID().slice(0, 8)}`;
  utterances = [];
  level = 'green';
  calmStreak = 0;
  verification = 'unasked';
  familyAlerted = false;
  agentStatus = 'idle';
  demo = null;
  $('transcript').replaceChildren();
  $('verify').hidden = true;
  $('alerted').hidden = true;
  $('agent').hidden = true;
  render({
    callId,
    risk: 0,
    level: 'green',
    tactics: [],
    reason: '',
    action: 'none',
    updatedAt: 0,
    calmStreak: 0,
    claimedRelative: false,
    elderState: 'none',
    familyAlerted: false,
  });
}

function stop() {
  running = false;
  transcriber?.stop();
  transcriber = null;
  clearTimeout(agentTimer);
  clearTimeout(silenceTimer);
  stopSpeaking();
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

function addSentence(text: string, speaker: string) {
  if (!running) return;
  partialEl?.remove();
  partialEl = null;
  const li = document.createElement('li');
  li.textContent = speaker === 'agent' ? `Helper: ${text}` : text;
  if (speaker === 'agent') li.className = 'agent-line';
  $('transcript').append(li);
  utterances.push({ callId, elderId: 'e-01', speaker, text, ts: Date.now(), seq: utterances.length });

  if (speaker === 'agent') return;
  if (agentStatus === 'active') {
    // The caller is answering the agent: reply after they pause.
    clearTimeout(silenceTimer);
    clearTimeout(agentTimer);
    agentTimer = setTimeout(() => void agentTurn(), AGENT_REPLY_DELAY_MS);
  } else if (agentStatus !== 'scam_confirmed') {
    // Serialize requests so each one carries the previous level.
    inFlight = inFlight.then(analyze);
  }
}

async function analyze() {
  if (!running || agentStatus === 'active') return;
  const body: AnalyzeRequest = { callId, elderId: 'e-01', utterances, prevLevel: level, calmStreak, verification, familyAlerted, agentStatus };
  const t0 = performance.now();
  try {
    const res = await fetch(import.meta.env.VITE_ANALYZE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = (await res.json()) as RiskState;
    if (!running) return;
    level = s.level;
    calmStreak = s.calmStreak;
    familyAlerted ||= s.familyAlerted;
    render(s);
    status(`Checked in ${Math.round(performance.now() - t0)} ms`);
    if (s.action === 'agent_takeover' && agentStatus === 'idle') startAgent();
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
  if (familyAlerted) $('alerted').hidden = false;
}

function answerVerification(v: Verification) {
  verification = v;
  $('verify').hidden = true;
  // Re-score now with the answer instead of waiting for the next sentence.
  if (utterances.length) inFlight = inFlight.then(analyze);
}

// --- Agent takeover -------------------------------------------------------

function startAgent() {
  agentStatus = 'active';
  $('verify').hidden = true;
  $('agent').hidden = false;
  $('agent').className = 'card agent';
  $('agent-title').textContent = 'Your family is taking this call';
  $('agent-text').textContent = "Stay quiet and don't hang up yet. Tap below if you want to talk.";
  $('agent-stop').hidden = false;
  void agentTurn();
}

async function agentTurn() {
  if (agentStatus !== 'active' || agentBusy || !running) return;
  agentBusy = true;
  try {
    const res = await fetch(import.meta.env.VITE_AGENT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId, elderId: 'e-01', utterances }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const a = (await res.json()) as AgentResponse;
    if (agentStatus !== 'active' || !running) return;

    if (a.say) {
      transcriber?.setMuted(true);
      addSentence(a.say, 'agent');
      await speak(a.say);
      // Short tail so the end of our own voice isn't transcribed.
      await new Promise((r) => setTimeout(r, 300));
      transcriber?.setMuted(false);
    }
    if (a.status !== 'active') return finishAgent(a.status, a.summary);

    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => finishAgent('caller_left', 'The caller went quiet.'), CALLER_SILENCE_MS);
    if (demo) playDemoReply();
  } catch (err) {
    status(`Helper failed (${String(err)}). Hang up if you're unsure.`);
  } finally {
    agentBusy = false;
  }
}

function finishAgent(result: AgentStatus, summary: string) {
  clearTimeout(agentTimer);
  clearTimeout(silenceTimer);
  stopSpeaking();
  transcriber?.setMuted(false);
  agentStatus = result;
  $('agent-stop').hidden = true;
  const title = $('agent-title');
  const text = $('agent-text');
  if (result === 'verified') {
    $('agent').className = 'card agent ok';
    title.textContent = 'The caller passed the check';
    text.textContent = 'You can talk to them now.';
    level = 'yellow';
    $('light').className = 'light yellow';
    $('level').textContent = LABEL.yellow;
  } else if (result === 'scam_confirmed') {
    $('agent').className = 'card agent bad';
    title.textContent = 'Hang up now';
    text.textContent = 'This is a scam. Your family has been told. Do not call this number back.';
  } else if (result === 'caller_left') {
    title.textContent = 'The caller left';
    text.textContent = summary || 'You can hang up.';
  } else {
    title.textContent = 'You have the call back';
    text.textContent = 'Be careful. Do not send money or share any numbers.';
  }
}

// --- Demo mode ------------------------------------------------------------

async function playDemo(name: string) {
  const script = TEST_SCRIPTS.find((s) => s.name === name)!;
  demo = { script, replies: [...(script.agentReplies ?? [])] };
  status(`Playing ${name}`);
  for (const line of script.lines) {
    if (!running || agentStatus !== 'idle') return; // stopped, or the agent took over
    addSentence(line.text, line.speaker);
    await inFlight;
    await new Promise((r) => setTimeout(r, 1500));
  }
  status(`Finished ${name}`);
}

function playDemoReply() {
  const reply = demo?.replies.shift();
  if (reply) setTimeout(() => addSentence(reply, 'caller'), 800);
}

function status(text: string) {
  $('status').textContent = text;
}
