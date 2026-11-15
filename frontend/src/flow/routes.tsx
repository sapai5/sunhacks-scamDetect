// Demo flow wiring: connects the (presentational) screens to settings, the call,
// and navigation. Screens stay dumb; this is the only place that decides "what's next".
//
//   /  ->  onboarding O1 -> O2 -> O3  ->  E1 idle  ->  live call (E1a/E2/E3/E4/E5)  ->  E6 summary  ->  E1
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { CallEventSheet } from '../components/CallEvents';
import { unlockAudio, useCallAlerts, vibrate } from '../lib/alerts';
import { MIC_AVAILABLE, syncSettings } from '../lib/api';
import { useCallContext } from '../lib/CallContext';
import type { ElderView } from '../lib/callState';
import { useThemeColor, useVisible, useWakeLock } from '../lib/pwa';
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
        void syncSettings(saveSettings({ onboarded: true }));
        nav(FLOW.idle);
      }}
    />
  );
}

export function IdleRoute() {
  const nav = useNavigate();
  const call = useCallContext();
  // A phone call the backend started checking (pushed over the socket) opens the live screens.
  useEffect(() => {
    if (call.running) nav(FLOW.live);
  }, [call.running, nav]);
  return (
    <E1Idle
      familyCount={loadSettings().family.filter((c) => c.phone).length}
      scripts={TEST_SCRIPTS.map((s) => s.name)}
      micAvailable={MIC_AVAILABLE}
      onStart={(mode) => {
        unlockAudio(); // this tap is what lets the red-alert sound play later (call.start unlocks speech)
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
  // Mobile PWA: keep the screen on (a locked screen stops the mic), sound/vibrate on escalation,
  // turn the status bar red on a scam, and warn if the app was backgrounded mid-call.
  useWakeLock(call.running);
  useCallAlerts(call.view, call.running);
  useThemeColor(call.view === 'red' ? '#b91c1c' : '#ffffff');
  const wasBackgrounded = useBackgroundedDuring(call.running);

  // The call can end without a tap (dial tone / long silence auto-end): go to the summary.
  const wasRunning = useRef(call.running);
  useEffect(() => {
    if (wasRunning.current && !call.running) nav(FLOW.summary);
    wasRunning.current = call.running;
  }, [call.running, nav]);

  if (!call.running && !call.risk) return <Navigate to={FLOW.idle} replace />;

  const Screen = BY_VIEW[call.view];
  const events = call.callEvents;
  // Hang up / End call: logged as a hang-up event (the family is alerted on red calls). Stopping
  // the call navigates to the summary via the effect above.
  const end = () => {
    vibrate(30);
    events.hangUp();
  };
  // While the agent has the call, or after it ended the call, show the takeover screen.
  // 'verified' and 'stopped' hand the call back, so the normal screens take over again.
  const takeover = ['active', 'scam_confirmed', 'caller_left'].includes(call.agentStatus);
  return (
    <>
      {wasBackgrounded && (
        <p className="call-banner" role="alert">
          Keep Call Me Maybe... NOT open during the call. Listening may have paused while it was in the background.
        </p>
      )}
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
        <Screen
          risk={call.risk}
          elapsed={elapsed}
          onEnd={end}
          onAnswer={(v) => {
            vibrate(30);
            call.answerVerification(v);
          }}
        />
      )}
      {events.prompt && call.running && (
        <CallEventSheet
          prompt={events.prompt}
          onStillOnSpeaker={() => {
            vibrate(30);
            events.stillOnSpeaker();
          }}
          onEnded={() => {
            vibrate(30);
            events.confirmEnded();
          }}
          onDismiss={events.dismiss}
        />
      )}
      <details className="dev-panel">
        <summary>
          {call.view} · {call.latencyMs ?? '–'} ms · {call.status}
        </summary>
        {/* Demo mode has no mic: fake what the hang-up / speaker detector would hear. */}
        <div className="dev-panel__sim">
          <button type="button" onClick={() => events.simulate('voice_lost')}>Sim: caller not heard</button>
          <button type="button" onClick={() => events.simulate('voice_back')}>Sim: caller back</button>
          <button type="button" onClick={() => events.simulate('tone')}>Sim: dial tone</button>
        </div>
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

/** True once the app has been hidden while `active` (iOS suspends the mic in the background). */
function useBackgroundedDuring(active: boolean) {
  const visible = useVisible();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!active) setHidden(false);
    else if (!visible) setHidden(true);
  }, [active, visible]);
  return hidden;
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
