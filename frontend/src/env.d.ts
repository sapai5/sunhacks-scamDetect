/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Written by `npm run deploy -w backend` (scripts/write-web-env.ts). */
  readonly VITE_REGION?: string;
  readonly VITE_CREDENTIALS_URL?: string;
  readonly VITE_ANALYZE_URL?: string;
  /** Optional overrides. */
  readonly VITE_SERVICE_MODE?: 'aws' | 'mock';
  readonly VITE_ELDER_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
