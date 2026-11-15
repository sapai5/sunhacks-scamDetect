// One call (plus its hang-up/speaker events) shared by every route, so the call keeps running
// while the app navigates (idle -> live -> summary), and is broadcast to other tabs (dashboard).
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { listenForPhoneCalls } from './api';
import { usePublishSnapshot, type CallSnapshot } from './snapshot';
import { useCall, type CallController } from './useCall';
import { useCallEvents, type CallEventsController } from './useCallEvents';

export type CallContextValue = CallController & { callEvents: CallEventsController; snapshot: CallSnapshot };

const Ctx = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const call = useCall();
  const callEvents = useCallEvents(call);
  // Phone calls the backend is checking arrive over the push socket, on any screen.
  // A new one opens the live screen even when the elder is on Past calls or Settings.
  const { follow } = call;
  useEffect(
    () =>
      listenForPhoneCalls('e-01', (m) => {
        if (follow(m) === 'new') nav('/elder/live');
      }),
    [follow, nav],
  );
  const snapshot = useMemo<CallSnapshot>(() => ({ ...call.snapshot, events: callEvents.events }), [call.snapshot, callEvents.events]);
  usePublishSnapshot(snapshot);
  return <Ctx.Provider value={{ ...call, callEvents, snapshot }}>{children}</Ctx.Provider>;
}

export function useCallContext(): CallContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCallContext must be inside <CallProvider>');
  return c;
}
