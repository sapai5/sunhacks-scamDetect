// Minimal screen switcher. A PWA with four screens doesn't need a router yet;
// swap this for react-router if deep links or browser history become needed.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ScreenId = 'home' | 'call' | 'summary' | 'settings';

interface Nav {
  screen: ScreenId;
  navigate(to: ScreenId): void;
}

const Ctx = createContext<Nav | null>(null);

export function NavigationProvider({ initial = 'home', children }: { initial?: ScreenId; children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenId>(initial);
  const navigate = useCallback((to: ScreenId) => {
    setScreen(to);
    window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ screen, navigate }), [screen, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavigation(): Nav {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNavigation must be used inside <NavigationProvider>');
  return v;
}
