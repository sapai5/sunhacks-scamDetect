// One call (plus its hang-up/speaker events) shared by every route, so the call keeps running
// while the app navigates (idle -> live -> summary), and is broadcast to other tabs (dashboard).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePublishSnapshot, type CallSnapshot } from './snapshot';
import { useCall, type CallController } from './useCall';
import { useCallEvents, type CallEventsController } from './useCallEvents';

export type CallContextValue = CallController & { callEvents: CallEventsController; snapshot: CallSnapshot };

const Ctx = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCall();
  const callEvents = useCallEvents(call);
  const snapshot = useMemo<CallSnapshot>(() => ({ ...call.snapshot, events: callEvents.events }), [call.snapshot, callEvents.events]);
  usePublishSnapshot(snapshot);
  return <Ctx.Provider value={{ ...call, callEvents, snapshot }}>{children}</Ctx.Provider>;
}

export function useCallContext(): CallContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCallContext must be inside <CallProvider>');
  return c;
}
