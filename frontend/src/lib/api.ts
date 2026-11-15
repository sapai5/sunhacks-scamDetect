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

/** The open push socket, for sending "Let me talk" back and for turning call alerts on. */
let pushSocket: WebSocket | undefined;
let pushElderId = 'e-01';

/** A message waiting to go out on the one push socket. A second socket fails on iPhone. */
interface PushWaiter {
  data: string;
  sent: boolean;
  until?: (m: unknown) => boolean;
  resolve: (v: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  done: boolean;
  /** Set once a message that expects no reply has been sent. */
  ack?: ReturnType<typeof setTimeout>;
}
const pushWaiters: PushWaiter[] = [];

function settleWaiter(w: PushWaiter, value: unknown) {
  if (w.done) return;
  w.done = true;
  clearTimeout(w.timer);
  if (w.ack) clearTimeout(w.ack);
  const i = pushWaiters.indexOf(w);
  if (i >= 0) pushWaiters.splice(i, 1);
  w.resolve(value);
}

/** Send anything queued. A socket that died mid-send is tried again on the next connection. */
function flushPushWaiters() {
  const ws = pushSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const w of pushWaiters) {
    if (w.sent) continue;
    try {
      ws.send(w.data);
    } catch {
      // The socket closed between the check and the send. The next connection sends it.
      return;
    }
    w.sent = true;
    if (!w.until) w.ack = setTimeout(() => settleWaiter(w, undefined), 500);
  }
}

function takePushMessage(raw: string, onCall: (m: PushMessage) => void) {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  for (const w of [...pushWaiters]) if (w.until?.(m)) settleWaiter(w, m);
  const call = m as PushMessage;
  if (typeof call.callId === 'string' && call.level) onCall(call);
}

/**
 * One message on the call socket. With `until`, waits for the reply that matches (call updates
 * are ignored). Without it, resolves once the message has been sent. Rejects after 8 s.
 * Off without a push URL or with ?mock.
 */
export function requestPush<T = unknown>(msg: object, until?: (m: unknown) => boolean): Promise<T> {
  if (!PUSH_URL || FORCE_MOCK) return Promise.reject(new Error('call alerts are not available'));
  return new Promise((resolve, reject) => {
    const w: PushWaiter = {
      data: JSON.stringify(msg),
      sent: false,
      until,
      resolve: (v) => resolve(v as T),
      done: false,
      timer: setTimeout(() => {
        if (w.done) return;
        w.done = true;
        const i = pushWaiters.indexOf(w);
        if (i >= 0) pushWaiters.splice(i, 1);
        reject(new Error('the server did not answer'));
      }, 8_000),
    };
    pushWaiters.push(w);
    flushPushWaiters();
  });
}

/**
 * Phone path: the backend pushes each phone call's RiskState and phone agent progress over a
 * WebSocket. Calls onMessage for each one and reconnects whenever the socket closes (API Gateway
 * drops idle sockets after 10 minutes). Returns a function that closes it. Off without VITE_PUSH_URL or with ?mock.
 *
 * iOS suspends the page while the Phone app is in front and often leaves the socket looking open
 * but dead. Coming back to the app drops that socket and connects again, which asks for the call
 * in progress, so a call that started in the background still shows up.
 */
export function listenForPhoneCalls(elderId: string, onMessage: (m: PushMessage) => void): () => void {
  if (!PUSH_URL || FORCE_MOCK) return () => {};
  pushElderId = elderId;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const open = () => {
    let ws: WebSocket;
    try {
      ws = pushSocket = new WebSocket(`${PUSH_URL}?elderId=${encodeURIComponent(pushElderId)}`);
    } catch {
      if (!closed) retry = setTimeout(open, 5_000);
      return;
    }
    ws.onopen = () => {
      // Ask for the call in progress (or just ended), so an app opened from a call alert shows it at once.
      ws.send(JSON.stringify({ action: 'current', elderId: pushElderId }));
      flushPushWaiters();
    };
    ws.onmessage = (e) => takePushMessage(String(e.data), onMessage);
    ws.onclose = () => {
      if (!closed && pushSocket === ws) retry = setTimeout(open, 5_000);
    };
  };
  // Close without letting onclose schedule a second reconnect. Used when we open again ourselves.
  const drop = () => {
    clearTimeout(retry);
    const ws = pushSocket;
    if (!ws) return;
    pushSocket = undefined;
    ws.onclose = null;
    ws.close();
    // The new socket sends these again. A reply that never arrived is not lost.
    for (const w of pushWaiters) {
      w.sent = false;
      if (w.ack) clearTimeout(w.ack);
      w.ack = undefined;
    }
  };
  const resync = () => {
    if (closed || document.visibilityState === 'hidden') return;
    drop();
    open();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') resync();
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) resync();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', resync);
  open();
  return () => {
    closed = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', resync);
    drop();
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
