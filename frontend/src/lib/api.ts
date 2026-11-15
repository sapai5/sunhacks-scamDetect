// The two backend endpoints. See contracts/index.ts for the shapes.
import type { AnalyzeRequest, RiskState } from '../../../contracts/index.js';
import { mockAnalyze } from './mockAnalyze';

const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL;

/** True when no Analyze URL is configured, or the page was opened with ?mock. */
export const USE_MOCK = !ANALYZE_URL || new URLSearchParams(location.search).has('mock');

/** Mic mode needs the Credentials Lambda (Transcribe runs in the browser). */
export const MIC_AVAILABLE = Boolean(import.meta.env.VITE_CREDENTIALS_URL);

/**
 * POST /analyze. Stateless: send the whole call so far, get the new risk state.
 * Note: a real red result texts the family through SNS.
 */
export async function analyze(req: AnalyzeRequest): Promise<RiskState> {
  if (USE_MOCK) return mockAnalyze(req);
  const res = await fetch(ANALYZE_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`analyze: HTTP ${res.status}`);
  return (await res.json()) as RiskState;
}
