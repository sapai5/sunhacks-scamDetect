// Call state for the live flow. All call state lives in the browser and goes along
// with every analyze request (the Lambdas are stateless).
import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentStatus, PushMessage, RiskState, Utterance, Verification } from '../../../contracts/index.js';
import { TEST_SCRIPTS } from '../../../backend/scripts/test-scripts.js';
import { agentTurn, analyze, sendToPhoneCall } from './api';
import { rememberPushedCall } from './callLog';
import { elderView, pushedStateEffect } from './callState';
import type { CallSnapshot, RiskPoint } from './snapshot';
import { speak, stopSpeaking, unlockSpeech } from './speech';
import type { Transcriber } from './transcribe';

export { TEST_SCRIPTS };
export type StartMode = { kind: 'mic' } | { kind: 'demo'; script: string };

/** Wait this long after the caller's last sentence before the agent answers. */
const AGENT_REPLY_DELAY_MS = 1200;
/** If the caller says nothing for this long after the agent speaks, treat them as gone. */
const CALLER_SILENCE_MS = 25_000;

/**
 * 8-char call id. crypto.randomUUID only exists in secure contexts (HTTPS / localhost), and the
 * demo is often opened on a phone over plain http://<LAN IP>, so fall back to getRandomValues.
 */
const shortId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : null);

export function useCall() {
  const [running, setRunning] = useState(false);
  const [callId, setCallId] = useState('');
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [verification, setVerification] = useState<Verification>('unasked');
  const [question, setQuestion] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [history, setHistory] = useState<RiskPoint[]>([]);
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState('');
  const [latencies, setLatencies] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [agentSummary, setAgentSummary] = useState('');

  // Refs hold what the request chain reads, so requests stay serialised and current.
  const s = useRef({
    callId: '',
    utterances: [] as Utterance[],
    risk: null as RiskState | null,
    verification: 'unasked' as Verification,
    familyAlerted: false,
    agentStatus: 'idle' as AgentStatus,
    agentBusy: false,
    agentTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    silenceTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** Demo mode: what the scripted caller says back to the agent. */
    demoReplies: null as string[] | null,
    inFlight: Promise.resolve(),
    transcriber: null as Transcriber | null,
    running: false,
    /** A phone call the backend scores (pushed RiskStates), not a speakerphone or demo call. */
    phone: false,
    /** Listeners for raw mic audio (hang-up / speaker detection) and finished caller lines. */
    audioListeners: new Set<(chunk: Float32Array, sampleRate: number) => void>(),
    lineListeners: new Set<(text: string) => void>(),
  });

  const setAgent = useCallback((st: AgentStatus) => {
    s.current.agentStatus = st;
    setAgentStatus(st);
  }, []);

  const runAnalyze = useCallback(async (note?: string) => {
    const r = s.current;
    if (!r.running || r.agentStatus === 'active') return;
    const callAtStart = r.callId;
    const t0 = performance.now();
    try {
      const next = await analyze({
        callId: r.callId,
        elderId: 'e-01',
        utterances: r.utterances,
        prevLevel: r.risk?.level ?? 'green',
        calmStreak: r.risk?.calmStreak ?? 0,
        verification: r.verification,
        familyAlerted: r.familyAlerted,
        agentStatus: r.agentStatus,
      });
      if (r.callId !== callAtStart || !r.running) return; // a new call started, or this one ended
      const prev = r.risk;
      // familyAlerted is only true on the response that sent the alert; keep it sticky.
      r.familyAlerted ||= next.familyAlerted;
      next.familyAlerted = r.familyAlerted;
      r.risk = next;
      setRisk(next);
      if (next.verificationQuestion) setQuestion(next.verificationQuestion);
      setHistory((h) => [
        ...h,
        {
          seq: r.utterances.length - 1,
          risk: next.risk,
          level: next.level,
          newTactics: next.tactics.filter((t) => !prev?.tactics.includes(t)),
          note,
        },
      ]);
      setLatencies((l) => [...l, Math.round(performance.now() - t0)]);
      if (next.action === 'agent_takeover' && r.agentStatus === 'idle') startAgent();
    } catch (err) {
      setStatus(`Check failed (${String(err)}), keeping last result`);
    }
    // startAgent is defined below and only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushUtterance = (speaker: string, text: string) => {
    const r = s.current;
    const u: Utterance = { callId: r.callId, elderId: 'e-01', speaker, text, ts: Date.now(), seq: r.utterances.length };
    r.utterances = [...r.utterances, u];
    setTranscript(r.utterances);
  };

  const finishAgent = useCallback(
    (result: AgentStatus, summary: string) => {
      const r = s.current;
      clearTimeout(r.agentTimer);
      clearTimeout(r.silenceTimer);
      stopSpeaking();
      r.transcriber?.setMuted(false);
      setAgentSpeaking(false);
      setAgentSummary(summary);
      setAgent(result);
      if (result === 'verified' && r.risk) {
        // The caller passed: drop to yellow now; the backend keeps it from going red again.
        r.risk = { ...r.risk, level: 'yellow', risk: Math.min(r.risk.risk, 55), action: 'none' };
        setRisk(r.risk);
      }
    },
    [setAgent],
  );

  const runAgentTurn = useCallback(async () => {
    const r = s.current;
    if (r.agentStatus !== 'active' || r.agentBusy || !r.running) return;
    r.agentBusy = true;
    const callAtStart = r.callId;
    try {
      const a = await agentTurn({ callId: r.callId, elderId: 'e-01', utterances: r.utterances });
      if (r.callId !== callAtStart || r.agentStatus !== 'active' || !r.running) return;
      if (a.say) {
        r.transcriber?.setMuted(true);
        pushUtterance('agent', a.say);
        setAgentSpeaking(true);
        await speak(a.say);
        // Short tail so the end of our own voice isn't transcribed.
        await new Promise((res) => setTimeout(res, 300));
        setAgentSpeaking(false);
        r.transcriber?.setMuted(false);
      }
      if (a.status !== 'active') return finishAgent(a.status, a.summary);
      clearTimeout(r.silenceTimer);
      r.silenceTimer = setTimeout(() => finishAgent('caller_left', 'The caller went quiet.'), CALLER_SILENCE_MS);
      const reply = r.demoReplies?.shift();
      if (reply) setTimeout(() => addSentence(reply, 'caller'), 800);
    } catch (err) {
      setStatus(`Helper failed (${String(err)}). Hang up if you're unsure.`);
    } finally {
      r.agentBusy = false;
    }
    // addSentence is defined below and only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishAgent]);

  function startAgent() {
    setAgent('active');
    void runAgentTurn();
  }

  const addSentence = useCallback(
    (text: string, speaker = 'caller') => {
      const r = s.current;
      if (!r.running) return;
      pushUtterance(speaker, text);
      setPartial('');
      if (speaker !== 'agent') r.lineListeners.forEach((l) => l(text));
      if (r.agentStatus === 'active') {
        // The caller is answering the agent: reply after they pause.
        clearTimeout(r.silenceTimer);
        clearTimeout(r.agentTimer);
        r.agentTimer = setTimeout(() => void runAgentTurn(), AGENT_REPLY_DELAY_MS);
      } else if (r.agentStatus !== 'scam_confirmed') {
        r.inFlight = r.inFlight.then(() => runAnalyze());
      }
    },
    [runAnalyze, runAgentTurn],
  );

  const stop = useCallback(() => {
    const r = s.current;
    r.transcriber?.stop();
    r.transcriber = null;
    r.running = false;
    clearTimeout(r.agentTimer);
    clearTimeout(r.silenceTimer);
    stopSpeaking();
    setAgentSpeaking(false);
    setRunning(false);
  }, []);

  /** Reset everything for a new call with this id and mark it running. */
  const begin = useCallback((id: string, phone: boolean) => {
    const r = s.current;
    r.transcriber?.stop();
    clearTimeout(r.agentTimer);
    clearTimeout(r.silenceTimer);
    Object.assign(r, {
      callId: id,
      utterances: [],
      risk: null,
      verification: 'unasked',
      familyAlerted: false,
      agentStatus: 'idle',
      agentBusy: false,
      demoReplies: null,
      running: true,
      phone,
      transcriber: null,
      inFlight: Promise.resolve(),
    });
    setCallId(id);
    setRisk(null);
    setVerification('unasked');
    setQuestion(null);
    setTranscript([]);
    setHistory([]);
    setPartial('');
    setLatencies([]);
    setAgentStatus('idle');
    setAgentSpeaking(false);
    setAgentSummary('');
    setStartedAt(Date.now());
    setRunning(true);
  }, []);

  /**
   * Phone path: a RiskState the backend pushed for a phone call it is scoring (IngestFn).
   * Shows that call on the live screens; nothing is sent from here. A speakerphone or demo
   * call in progress takes priority, and a call the elder already ended stays ended.
   */
  const follow = useCallback(
    (next: PushMessage) => {
      const r = s.current;
      const effect = pushedStateEffect(r, next);
      // A call the screen is not showing (it ended while the phone app was in front, or another
      // call is up) still belongs in the log. An older result for the call on screen does not.
      if (effect === 'ignore') {
        if (r.callId !== next.callId || next.ended) rememberPushedCall(next);
        return effect;
      }
      if (effect === 'new') {
        begin(next.callId, true);
        setStatus('Phone call, checked by the server');
      }
      if (!r.risk || next.updatedAt > r.risk.updatedAt) {
        const prev = r.risk;
        // familyAlerted is only true on the result that sent the alert; keep it sticky.
        r.familyAlerted ||= next.familyAlerted;
        r.risk = { ...next, familyAlerted: r.familyAlerted };
        setRisk(r.risk);
        if (next.verificationQuestion) setQuestion(next.verificationQuestion);
        setHistory((h) => [
          ...h,
          { seq: h.length, risk: next.risk, level: next.level, newTactics: next.tactics.filter((t) => !prev?.tactics.includes(t)) },
        ]);
      }
      // The server's phone agent speaks into the call itself; the app shows its lines and status (E7).
      const say = next.agentSay;
      if (say && say !== r.utterances.at(-1)?.text) {
        pushUtterance('agent', say);
        setAgentSpeaking(true);
        setTimeout(() => setAgentSpeaking(false), Math.min(8_000, 500 + say.length * 60)); // rough speaking time
      }
      // Never undo the elder's "Let me talk" or a finished takeover with a late message.
      if (next.agentStatus !== r.agentStatus && (r.agentStatus === 'idle' || r.agentStatus === 'active')) {
        if (r.agentStatus === 'active') finishAgent(next.agentStatus, next.agentSummary ?? '');
        else setAgent(next.agentStatus);
      }
      // Hung up (either side): close the call; the live screen moves on to the summary.
      if (next.ended) stop();
      return effect;
    },
    // pushUtterance only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [begin, finishAgent, setAgent, stop],
  );

  const start = useCallback(
    async (mode: StartMode) => {
      unlockSpeech(); // must run inside the tap, for iOS
      const r = s.current;
      const id = `c-${shortId()}`;
      begin(id, false);
      try {
        if (mode.kind === 'demo') {
          const script = TEST_SCRIPTS.find((t) => t.name === mode.script);
          if (!script) throw new Error(`unknown script ${mode.script}`);
          r.demoReplies = [...(script.agentReplies ?? [])];
          setStatus(`Playing ${script.name}`);
          for (const line of script.lines) {
            await new Promise((res) => setTimeout(res, 1800));
            // Stop feeding the script once the call ends or the agent takes over.
            if (!r.running || r.callId !== id || r.agentStatus !== 'idle') return;
            addSentence(line.text, line.speaker);
            await r.inFlight;
          }
          setStatus(`Finished ${script.name}`);
        } else {
          setStatus('Connecting…');
          const { startTranscriber } = await import('./transcribe'); // keeps the AWS SDK out of the main bundle
          r.transcriber = await startTranscriber({
            onPartial: setPartial,
            onFinal: (text, speaker) => addSentence(text, speaker),
            onError: (err) => setStatus(`Transcribe error: ${String(err)}`),
            onAudio: (chunk, sampleRate) => r.audioListeners.forEach((l) => l(chunk, sampleRate)),
          });
          setStatus('Listening. Put the call on speaker next to this device.');
        }
      } catch (err) {
        setStatus(`Could not start: ${String(err)}`);
        stop();
      }
    },
    [addSentence, begin, stop],
  );

  /** Elder reports the caller's answer to the family question. Re-scores right away. */
  const answerVerification = useCallback(
    (v: Verification) => {
      const r = s.current;
      r.verification = v;
      setVerification(v);
      // Phone call: the server scores it, so send the answer there (it re-scores right away).
      if (r.phone) {
        if (v !== 'unasked' && !sendToPhoneCall({ action: 'verification', callId: r.callId, result: v })) {
          setStatus("Couldn't reach the server; your answer wasn't saved.");
        }
        return;
      }
      const note = v === 'failed' ? 'wrong answer to family question' : 'family question answered';
      if (r.utterances.length) r.inFlight = r.inFlight.then(() => runAnalyze(note));
    },
    [runAnalyze],
  );

  /** Elder taps "Let me talk": the agent stops and won't take over again this call. */
  const takeBack = useCallback(() => {
    // Phone call: the agent runs on the server, so tell it to stop.
    if (s.current.phone && !sendToPhoneCall({ action: 'stopAgent', callId: s.current.callId })) {
      setStatus("Couldn't reach the server; the helper may keep talking.");
    }
    finishAgent('stopped', '');
  }, [finishAgent]);

  /** Subscribe to mic audio (~100 ms chunks, mic mode only). Returns an unsubscribe function. */
  const subscribeAudio = useCallback((l: (chunk: Float32Array, sampleRate: number) => void) => {
    s.current.audioListeners.add(l);
    return () => void s.current.audioListeners.delete(l);
  }, []);
  /** Subscribe to finished caller lines (mic or demo). Returns an unsubscribe function. */
  const subscribeLines = useCallback((l: (text: string) => void) => {
    s.current.lineListeners.add(l);
    return () => void s.current.lineListeners.delete(l);
  }, []);
  /** Latest call id and risk, for async code that outlives a render. */
  const latest = useCallback(() => ({ callId: s.current.callId, risk: s.current.risk }), []);

  const view = elderView(risk, verification);
  const snapshot: CallSnapshot = useMemo(
    () => ({
      callId,
      running,
      startedAt,
      risk,
      view,
      verification,
      question,
      transcript,
      history,
      latencyMs: latencies.at(-1) ?? null,
      p95Ms: p95(latencies),
      agentStatus,
      events: [],
    }),
    [callId, running, startedAt, risk, view, verification, question, transcript, history, latencies, agentStatus],
  );

  return { ...snapshot, partial, status, agentSpeaking, agentSummary, start, stop, follow, answerVerification, takeBack, subscribeAudio, subscribeLines, latest, snapshot };
}

export type CallController = ReturnType<typeof useCall>;
