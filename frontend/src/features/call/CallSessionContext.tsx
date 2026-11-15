import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useServices } from '../../services/ServicesContext';
import { CallController, type CallSnapshot } from './callController';

const Ctx = createContext<CallController | null>(null);

/** One call session for the whole app, shared by the Call and Summary screens. */
export function CallSessionProvider({ children }: { children: ReactNode }) {
  const { services, config } = useServices();
  const [controller] = useState(() => new CallController({ analyze: services.analyze, elderId: config.elderId }));
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useCallController(): CallController {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCallController must be used inside <CallSessionProvider>');
  return c;
}

export function useCallSnapshot(): CallSnapshot {
  const c = useCallController();
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}
