interface ImportMetaEnv {
  readonly VITE_REGION: string;
  readonly VITE_CREDENTIALS_URL: string;
  readonly VITE_ANALYZE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
