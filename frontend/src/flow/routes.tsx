// Demo flow wiring: connects the (presentational) screens to settings, the call,
// and navigation. Screens stay dumb; this is the only place that decides "what's next".
//
//   /  ->  onboarding O1 -> O2 -> O3  ->  E1 idle  ->  live call (E1a/E2/E3/E4/E5)  ->  E6 summary  ->  E1
import { useEffect, useState, type ComponentType } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { MIC_AVAILABLE } from '../lib/api';
import { useCallContext } from '../lib/CallContext';
import type { ElderView } from '../lib/callState';
import { loadSettings, saveSettings } from '../lib/settings';
import { TEST_SCRIPTS } from '../lib/useCall';
import type { CallScreenProps } from '../screens/elder/CallLayout';
import E1aListening from '../screens/elder/E1aListening';
import E1Idle from '../screens/elder/E1Idle';
import E2Green from '../screens/elder/E2Green';
import E3Yellow from '../screens/elder/E3Yellow';
import E4Verifying from '../screens/elder/E4Verifying';
import E5Red from '../screens/elder/E5Red';
import E6Summary from '../screens/elder/E6Summary';
import E7Takeover from '../screens/elder/E7Takeover';
import O1FamilyContacts from '../screens/onboarding/O1FamilyContacts';
import O2SecretQuestion from '../screens/onboarding/O2SecretQuestion';
import O3Microphone from '../screens/onboarding/O3Microphone';

export const FLOW = {
  start: '/',
  o1: '/onboarding/family',
  o2: '/onboarding/question',
  o3: '/onboarding/mic',
  idle: '/elder/idle',
  live: '/elder/live',
  summary: '/elder/summary',
} as const;

export function StartRoute() {
  return <Navigate to={loadSettings().onboarded ? FLOW.idle : FLOW.o1} replace />;
}

export function O1Route() {
  const nav = useNavigate();
  return (
    <O1FamilyContacts
      initial={loadSettings().family}
      onNext={(family) => {
        saveSettings({ family });
        nav(FLOW.o2);
      }}
    />
  );
}

export function O2Route() {
  const nav = useNavigate();
  const s = loadSettings();
  return (
    <O2SecretQuestion
      initial={{ question: s.question, answer: s.answer }}
      onNext={(v) => {
        saveSettings(v);
        nav(FLOW.o3);
      }}
    />
  );
}

export function O3Route() {
  const nav = useNavigate();
  return (
    <O3Microphone
      onAllow={async () => {
        // Ask now (from the tap) so the live call doesn't prompt mid-call. Demo mode works without it.
        try {
          const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
          stream?.getTracks().forEach((t) => t.stop());
        } catch {
          /* denied or no mic: demo scripts still work */
        }
        saveSettings({ onboarded: true });
        nav(FLOW.idle);
      }}
    />
  );
}

export function IdleRoute() {
  const nav = useNavigate();
  const call = useCallContext();
  return (
    <E1Idle
      familyCount={loadSettings().family.filter((c) => c.phone).length}
      scripts={TEST_SCRIPTS.map((s) => s.name)}
      micAvailable={MIC_AVAILABLE}
      onStart={(mode) => {
        nav(FLOW.live);
        void call.start(mode);
      }}
    />
  );
}

const BY_VIEW: Record<ElderView, ComponentType<CallScreenProps>> = {
  listening: E1aListening,
  green: E2Green,
  yellow: E3Yellow,
  verifying: E4Verifying,
  red: E5Red,
};

/** The live call: shows whichever E screen matches the call state. */
export function LiveRoute() {
  const nav = useNavigate();
  const call = useCallContext();
  const elapsed = useElapsed(call.running ? call.startedAt : null);

  if (!call.running && !call.risk) return <Navigate to={FLOW.idle} replace />;

  const Screen = BY_VIEW[call.view];
  const end = () => {
    call.stop();
    nav(FLOW.summary);
  };
  // While the agent has the call, or after it ended the call, show the takeover screen.
  // 'verified' and 'stopped' hand the call back, so the normal screens take over again.
  const takeover = ['active', 'scam_confirmed', 'caller_left'].includes(call.agentStatus);
  return (
    <>
      {takeover ? (
        <E7Takeover
          agentStatus={call.agentStatus}
          speaking={call.agentSpeaking}
          summary={call.agentSummary}
          elapsed={elapsed}
          onEnd={end}
          onTakeBack={call.takeBack}
        />
      ) : (
        <Screen risk={call.risk} elapsed={elapsed} onEnd={end} onAnswer={call.answerVerification} />
      )}
      <details className="dev-panel">
        <summary>
          {call.view} · {call.latencyMs ?? '–'} ms · {call.status}
        </summary>
        <ol>
          {call.transcript.map((u) => (
            <li key={u.seq}>
              [{u.speaker}] {u.text}
            </li>
          ))}
          {call.partial && <li className="partial">{call.partial}</li>}
        </ol>
      </details>
    </>
  );
}

export function SummaryRoute() {
  const nav = useNavigate();
  const call = useCallContext();
  // Before any call (e.g. in the schematic) the screen shows its sample data.
  return <E6Summary risk={call.callId ? call.risk : undefined} familyPhone={loadSettings().family.find((c) => c.phone)?.phone} onDone={() => nav(FLOW.idle)} />;
}

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}
