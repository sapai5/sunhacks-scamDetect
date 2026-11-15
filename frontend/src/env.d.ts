interface ImportMetaEnv {
  /** AWS region for Transcribe. Written by `npm run deploy -w backend`. */
  readonly VITE_REGION?: string;
  /** Credentials Lambda URL. Without it, mic mode is disabled. */
  readonly VITE_CREDENTIALS_URL?: string;
  /** Analyze Lambda URL. Without it, the app scores calls with the local mock. */
  readonly VITE_ANALYZE_URL?: string;
  /** Agent Lambda URL. Without it, the takeover agent uses the local mock. */
  readonly VITE_AGENT_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
