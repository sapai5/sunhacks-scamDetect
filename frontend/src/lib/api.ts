// The backend endpoints. See contracts/index.ts for the shapes.
import type { AgentRequest, AgentResponse, AnalyzeRequest, RiskState } from '../../../contracts/index.js';
import { mockAgent } from './mockAgent';
import { mockAnalyze } from './mockAnalyze';

const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL;
const AGENT_URL = import.meta.env.VITE_AGENT_URL;

/** True when no Analyze URL is configured, or the page was opened with ?mock. */
export const USE_MOCK = !ANALYZE_URL || new URLSearchParams(location.search).has('mock');

/** Mic mode needs the Credentials Lambda (Transcribe runs in the browser). */
export const MIC_AVAILABLE = Boolean(import.meta.env.VITE_CREDENTIALS_URL);

async function post<T>(url: string, body: unknown, name: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * POST /analyze. Stateless: send the whole call so far, get the new risk state.
 * Note: a real result can email the family through SNS.
 */
export async function analyze(req: AnalyzeRequest): Promise<RiskState> {
  if (USE_MOCK) return mockAnalyze(req);
  return post<RiskState>(ANALYZE_URL!, req, 'analyze');
}

/** POST /agent. The takeover agent's next line and status. */
export async function agentTurn(req: AgentRequest): Promise<AgentResponse> {
  if (USE_MOCK || !AGENT_URL) return mockAgent(req);
  return post<AgentResponse>(AGENT_URL, req, 'agent');
}
