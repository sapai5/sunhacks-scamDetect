// Runtime config from Vite env vars. `npm run deploy -w backend` writes these into
// frontend/.env.local. With no backend URLs the app falls back to mock services,
// so screens can be built and demoed before anything is deployed.

export type ServiceMode = 'aws' | 'mock';

export interface AppConfig {
  mode: ServiceMode;
  region: string;
  credentialsUrl: string;
  analyzeUrl: string;
  elderId: string;
}

export function readConfig(env: ImportMetaEnv = import.meta.env): AppConfig {
  const credentialsUrl = env.VITE_CREDENTIALS_URL?.trim() ?? '';
  const analyzeUrl = env.VITE_ANALYZE_URL?.trim() ?? '';
  const hasBackend = Boolean(credentialsUrl && analyzeUrl);
  const mode: ServiceMode = env.VITE_SERVICE_MODE ?? (hasBackend ? 'aws' : 'mock');
  if (mode === 'aws' && !hasBackend) {
    console.warn('VITE_SERVICE_MODE=aws but VITE_CREDENTIALS_URL / VITE_ANALYZE_URL are missing.');
  }
  return {
    mode,
    region: env.VITE_REGION?.trim() || 'us-east-1',
    credentialsUrl,
    analyzeUrl,
    elderId: env.VITE_ELDER_ID?.trim() || 'e-01',
  };
}
