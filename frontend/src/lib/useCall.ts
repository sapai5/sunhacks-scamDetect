// Call state for the live flow. All call state lives in the browser and goes along
// with every analyze request (the Lambda is stateless).
import { useCallback, useMemo, useRef, useState } from 'react';
import type { RiskState, Utterance, Verification } from '../../../contracts/index.js';
import { TEST_SCRIPTS } from '../../../backend/scripts/test-scripts.js';
import { analyze } from './api';
import { elderView } from './callState';
import type { CallSnapshot, RiskPoint } from './snapshot';

export { TEST_SCRIPTS };
export type StartMode = { kind: 'mic' } | { kind: 'demo'; script: string };

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

  // Refs hold what the request chain reads, so requests stay serialised and current.
  const s = useRef({
    callId: '',
    utterances: [] as Utterance[],
    risk: null as RiskState | null,
    verification: 'unasked' as Verification,
    inFlight: Promise.resolve(),
    stopFn: null as null | (() => void),
    running: false,
  });

  const runAnalyze = useCallback(async (note?: string) => {
    const r = s.current;
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
      });
      if (r.callId !== callAtStart) return; // a new call started meanwhile
      const prev = r.risk;
      // familyAlerted is only true on the response that sent the text; keep it sticky.
      if (prev?.familyAlerted) next.familyAlerted = true;
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
    } catch (err) {
      setStatus(`Check failed (${String(err)}), keeping last result`);
    }
  }, []);

  const addSentence = useCallback(
    (text: string) => {
      const r = s.current;
      const u: Utterance = { callId: r.callId, elderId: 'e-01', speaker: 'caller', text, ts: Date.now(), seq: r.utterances.length };
      r.utterances = [...r.utterances, u];
      setTranscript(r.utterances);
      setPartial('');
      r.inFlight = r.inFlight.then(() => runAnalyze());
    },
    [runAnalyze],
  );

  const stop = useCallback(() => {
    const r = s.current;
    r.stopFn?.();
    r.stopFn = null;
    r.running = false;
    setRunning(false);
  }, []);

  const start = useCallback(
    async (mode: StartMode) => {
      const r = s.current;
      r.stopFn?.();
      const id = `c-${crypto.randomUUID().slice(0, 8)}`;
      Object.assign(r, { callId: id, utterances: [], risk: null, verification: 'unasked', running: true, stopFn: null, inFlight: Promise.resolve() });
      setCallId(id);
      setRisk(null);
      setVerification('unasked');
      setQuestion(null);
      setTranscript([]);
      setHistory([]);
      setPartial('');
      setLatencies([]);
      setStartedAt(Date.now());
      setRunning(true);
      try {
        if (mode.kind === 'demo') {
          const script = TEST_SCRIPTS.find((t) => t.name === mode.script);
          if (!script) throw new Error(`unknown script ${mode.script}`);
          setStatus(`Playing ${script.name}`);
          for (const line of script.lines) {
            await new Promise((res) => setTimeout(res, 1800));
            if (!r.running || r.callId !== id) return;
            addSentence(line);
            await r.inFlight;
          }
          setStatus(`Finished ${script.name}`);
        } else {
          setStatus('Connecting…');
          const { startTranscriber } = await import('./transcribe'); // keeps the AWS SDK out of the main bundle
          r.stopFn = await startTranscriber({
            onPartial: setPartial,
            onFinal: addSentence,
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
    }),
    [callId, running, startedAt, risk, view, verification, question, transcript, history, latencies],
  );

  return { ...snapshot, partial, status, start, stop, answerVerification, snapshot };
}

export type CallController = ReturnType<typeof useCall>;
