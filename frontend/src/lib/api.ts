// The backend endpoints. See contracts/index.ts for the shapes.
import type {
  AgentRequest,
  AgentResponse,
  AnalyzeRequest,
  CallEventRequest,
  CallEventResponse,
  PushAppMessage,
  PushMessage,
  RiskState,
} from '../../../contracts/index.js';
import { mockAgent } from './mockAgent';
import { mockAnalyze } from './mockAnalyze';
import type { Settings } from './settings';

const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL;
const AGENT_URL = import.meta.env.VITE_AGENT_URL;
const EVENTS_URL = import.meta.env.VITE_EVENTS_URL;
const SETTINGS_URL = import.meta.env.VITE_SETTINGS_URL;
const PUSH_URL = import.meta.env.VITE_PUSH_URL;
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

/**
 * PUT the onboarding settings to the Settings API, so the agent asks this family question.
 * Never throws: onboarding works offline, and the backend keeps its last values (or cdk.json's).
 */
export async function syncSettings(s: Settings): Promise<boolean> {
  if (!SETTINGS_URL || FORCE_MOCK) return false;
  try {
    const res = await fetch(SETTINGS_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        elderId: 'e-01',
        family: s.family,
        ...(s.question.trim() && { verificationQuestion: s.question }),
        ...(s.answer.trim() && { verificationAnswer: s.answer }),
      }),
    });
    if (!res.ok) console.warn(`settings: HTTP ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.warn('settings: not saved to the backend', err);
    return false;
  }
}

/** The open push socket, for sending "Let me talk" back. */
let pushSocket: WebSocket | undefined;

/**
 * Phone path: the backend pushes each phone call's RiskState and phone agent progress over a
 * WebSocket. Calls onMessage for each one and reconnects whenever the socket closes (API Gateway
 * drops idle sockets after 10 minutes). Returns a function that closes it. Off without VITE_PUSH_URL or with ?mock.
 */
export function listenForPhoneCalls(elderId: string, onMessage: (m: PushMessage) => void): () => void {
  if (!PUSH_URL || FORCE_MOCK) return () => {};
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const open = () => {
    const ws = (pushSocket = new WebSocket(`${PUSH_URL}?elderId=${encodeURIComponent(elderId)}`));
    // Ask for the call in progress (or just ended), so an app opened from a call alert shows it at once.
    ws.onopen = () => ws.send(JSON.stringify({ action: 'current', elderId }));
    ws.onmessage = (e) => {
      let m: PushMessage;
      try {
        m = JSON.parse(e.data);
      } catch {
        return; // not JSON
      }
      if (typeof m.callId === 'string' && m.level) onMessage(m);
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 5_000);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    pushSocket?.close();
    pushSocket = undefined;
  };
}

/**
 * Tell the server about a phone call it is checking: "Let me talk" (stopAgent) or the elder's answer
 * on the Checking screen (verification). Returns false if the socket isn't open.
 */
export function sendToPhoneCall(msg: PushAppMessage): boolean {
  if (pushSocket?.readyState !== WebSocket.OPEN) return false;
  pushSocket.send(JSON.stringify(msg));
  return true;
}
