// The backend endpoints. See contracts/index.ts for the shapes.
import type { AgentRequest, AgentResponse, AnalyzeRequest, CallEventRequest, CallEventResponse, RiskState } from '../../../contracts/index.js';
import { mockAgent } from './mockAgent';
import { mockAnalyze } from './mockAnalyze';

const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL;
const AGENT_URL = import.meta.env.VITE_AGENT_URL;
const EVENTS_URL = import.meta.env.VITE_EVENTS_URL;
const FORCE_MOCK = new URLSearchParams(location.search).has('mock');

/** True when no Analyze URL is configured, or the page was opened with ?mock. */
export const USE_MOCK = !ANALYZE_URL || FORCE_MOCK;
/** Call events stay in the browser when there's no Events URL (or ?mock). */
export const EVENTS_MOCK = !EVENTS_URL || FORCE_MOCK;

/** Mic mode needs the Credentials Lambda (Transcribe runs in the browser). */
export const MIC_AVAILABLE = Boolean(import.meta.env.VITE_CREDENTIALS_URL);

async function post<T>(url: string, body: unknown, name: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The Lambdas reject more than 400 utterances but only read the last ~40 lines, so a long call
 * would start failing every request. Send just the tail.
 */
const MAX_SENT_UTTERANCES = 150;
const recent = <T,>(list: T[]): T[] => (list.length > MAX_SENT_UTTERANCES ? list.slice(-MAX_SENT_UTTERANCES) : list);

/**
 * POST /analyze. Stateless: send the whole call so far, get the new risk state.
 * Note: a real result can email the family through SNS.
 */
export async function analyze(req: AnalyzeRequest): Promise<RiskState> {
  if (USE_MOCK) return mockAnalyze(req);
  return post<RiskState>(ANALYZE_URL!, { ...req, utterances: recent(req.utterances) }, 'analyze', 15_000);
}

/** POST /agent. The takeover agent's next line and status. */
export async function agentTurn(req: AgentRequest): Promise<AgentResponse> {
  if (USE_MOCK || !AGENT_URL) return mockAgent(req);
  return post<AgentResponse>(AGENT_URL, { ...req, utterances: recent(req.utterances) }, 'agent', 15_000);
}

/**
 * POST /events: hang-up, off/on speaker, caller asking to go off speaker. The backend decides
 * whether to alert the family. Never throws; returns notified=false when offline or in mock mode.
 */
export async function postEvent(req: CallEventRequest): Promise<CallEventResponse> {
  if (EVENTS_MOCK) return { notified: false };
  try {
    return await post<CallEventResponse>(EVENTS_URL!, req, 'events', 5_000);
  } catch {
    return { notified: false };
  }
}
