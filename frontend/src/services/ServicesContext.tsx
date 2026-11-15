import { createContext, useContext, type ReactNode } from 'react';
import type { AppConfig } from '../config/env';
import type { Services } from './types';

interface ServicesValue {
  config: AppConfig;
  services: Services;
}

const Ctx = createContext<ServicesValue | null>(null);

export function ServicesProvider({ config, services, children }: ServicesValue & { children: ReactNode }) {
  return <Ctx.Provider value={{ config, services }}>{children}</Ctx.Provider>;
}

export function useServices(): ServicesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useServices must be used inside <ServicesProvider>');
  return v;
}
