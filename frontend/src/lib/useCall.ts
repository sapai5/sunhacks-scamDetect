// Call state for the live flow. All call state lives in the browser and goes along
// with every analyze request (the Lambdas are stateless).
import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentStatus, RiskState, Utterance, Verification } from '../../../contracts/index.js';
import { TEST_SCRIPTS } from '../../../backend/scripts/test-scripts.js';
import { agentTurn, analyze } from './api';
import { elderView } from './callState';
import type { CallSnapshot, RiskPoint } from './snapshot';
import { speak, stopSpeaking, unlockSpeech } from './speech';
import type { Transcriber } from './transcribe';

export { TEST_SCRIPTS };
export type StartMode = { kind: 'mic' } | { kind: 'demo'; script: string };

/** Wait this long after the caller's last sentence before the agent answers. */
const AGENT_REPLY_DELAY_MS = 1200;
/** If the caller says nothing for this long after the agent speaks, treat them as gone. */
const CALLER_SILENCE_MS = 25_000;

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

  const start = useCallback(
    async (mode: StartMode) => {
      unlockSpeech(); // must run inside the tap, for iOS
      const r = s.current;
      r.transcriber?.stop();
      clearTimeout(r.agentTimer);
      clearTimeout(r.silenceTimer);
      const id = `c-${crypto.randomUUID().slice(0, 8)}`;
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
          });
          setStatus('Listening. Put the call on speaker next to this device.');
        }
      } catch (err) {
        setStatus(`Could not start: ${String(err)}`);
        stop();
      }
    },
    [addSentence, stop],
  );

  /** Elder reports the caller's answer to the family question. Re-scores right away. */
  const answerVerification = useCallback(
    (v: Verification) => {
      const r = s.current;
      r.verification = v;
      setVerification(v);
      const note = v === 'failed' ? 'wrong answer to family question' : 'family question answered';
      if (r.utterances.length) r.inFlight = r.inFlight.then(() => runAnalyze(note));
    },
    [runAnalyze],
  );

  /** Elder taps "Let me talk": the agent stops and won't take over again this call. */
  const takeBack = useCallback(() => finishAgent('stopped', ''), [finishAgent]);

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
    }),
    [callId, running, startedAt, risk, view, verification, question, transcript, history, latencies, agentStatus],
  );

  return { ...snapshot, partial, status, agentSpeaking, agentSummary, start, stop, answerVerification, takeBack, snapshot };
}

export type CallController = ReturnType<typeof useCall>;
