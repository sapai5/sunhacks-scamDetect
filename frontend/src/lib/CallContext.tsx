// One call shared by every route, so the call keeps running while the app
// navigates (idle -> live -> summary), and is broadcast to other tabs (dashboard).
import { createContext, useContext, type ReactNode } from 'react';
import { usePublishSnapshot } from './snapshot';
import { useCall, type CallController } from './useCall';

const Ctx = createContext<CallController | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCall();
  usePublishSnapshot(call.snapshot);
  return <Ctx.Provider value={call}>{children}</Ctx.Provider>;
}

export function useCallContext(): CallController {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCallContext must be inside <CallProvider>');
  return c;
}
