// Twilio bridge: the phone path while Amazon Connect waits for its phone number quota.
//
//   caller -> Twilio number -> POST /voice
//     trusted caller   -> <Dial> the elder directly (no streaming)
//     unknown caller   -> <Start><Stream both_tracks> to /media, then <Dial> the elder (call forwarding)
//   /media WebSocket   -> mu-law -> PCM -> Transcribe (one stream per track)
//     inbound track  = caller, outbound track = what the caller hears = elder (later our agent)
//   each final sentence -> IngestFn (Track B) -> RiskState, saved in Calls, pushed to the app
//   agent_takeover     -> the caller's call is redirected to the agent (this drops the elder's leg).
//                         Default: opening line, then a two-way stream to /agent where Amazon Nova Sonic
//                         talks with the caller; the Agent Lambda (Claude Haiku) reads each caller reply
//                         and decides the verdict.
//                         AGENT_VOICE=say (fallback): each Agent Lambda line is <Say>, then the agent waits.
//   verified           -> "Here she is", then the agent hands back by dialing the elder again
//   scam confirmed     -> goodbye, hang up
// Trial-safe: no conferences, no inline TwiML, no `method` parameters.
//
// Run: npm run twilio -w backend   (see backend/twilio/README.md)
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import twilio from 'twilio';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentResponse, AgentStatus, IngestRequest, RiskState, Utterance } from '../../contracts/index.js';
import { isTrusted } from '../telephony/contacts-check/index.js';
import { mulawToPcm16, pcm16ToMulaw, speechMs } from './audio.js';
import { loadConfig } from './config.js';
import { elderTexter } from './elderTexts.js';
import { loadLocalBackend } from './local-backend.js';
import { openingLine, sonicSystemPrompt, startSonic, type SonicPersona, type SonicSession } from './sonic.js';
import { startTrackTranscriber, type TrackTranscriber } from './transcriber.js';
import { agentStream, agentTurn as agentTwiml, directDial, hangup, idle, screenedCall } from './twiml.js';

const cfg = await loadConfig();
const DRY_RUN = process.env.TWILIO_DRY_RUN === '1'; // local simulation: no Twilio REST calls
/** Set when LOCAL_BACKEND=1: IngestFn's and the Agent Lambda's code run in this process (no AWS Lambda). */
const backend = cfg.localBackend ? await loadLocalBackend(cfg) : undefined;
/** Phone speech gets split into short sentences ("Uncle Mike?" "Oh, hey."), so wait a bit longer than in the app. */
const AGENT_REPLY_DELAY_MS = 2000;
const CALLER_SILENCE_MS = 25_000;

const tw = twilio(cfg.accountSid, cfg.authToken);
const lambda = new LambdaClient({ region: cfg.region });
const transcribe = new TranscribeStreamingClient({
  region: cfg.region,
  // Only Transcribe can come from another account (TRANSCRIBE_AWS_PROFILE); everything else uses the main one.
  ...(cfg.transcribeProfile ? { credentials: defaultProvider({ profile: cfg.transcribeProfile }) } : {}),
});
const polly = new PollyClient({ region: cfg.region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.region }));

interface Call {
  callSid: string;
  /** Random per call. Authorizes the media stream and our TwiML URLs (Twilio's signature on redirects isn't reliable). */
  token: string;
  utterances: Utterance[];
  ingestChain: Promise<void>;
  agentStatus: AgentStatus;
  agentBusy: boolean;
  /** The caller spoke while the agent was busy: answer once when it's free. */
  replyPending: boolean;
  agentTimer?: NodeJS.Timeout;
  silenceTimer?: NodeJS.Timeout;
  /**
   * Outbound audio (elder side) is replaced with silence until then. During a takeover the elder is
   * disconnected and the outbound track is only our agent's voice, so it stays muted (Infinity).
   */
  mutedUntil: number;
  tracks: Partial<Record<'caller' | 'elder', TrackTranscriber>>;
  /** Set while Nova Sonic has the call (AGENT_VOICE=sonic). */
  sonic?: SonicTakeover;
}

/** A takeover where Nova Sonic talks with the caller over a two-way Twilio stream. */
interface SonicTakeover {
  session: SonicSession;
  /** The two-way stream, once Twilio has connected it (after the opening line). */
  ws?: WebSocket;
  streamSid?: string;
  /** What the agent is saying this turn; saved as one line when the turn ends. */
  agentText: string;
  flushTimer?: NodeJS.Timeout;
  judgeTimer?: NodeJS.Timeout;
  judging: boolean;
  judgeAgain: boolean;
  /** When the audio we sent finishes playing, and when the caller was last heard (epoch ms). */
  speakingUntil: number;
  lastHeard: number;
  /** "Are you still there?" prompts since the caller last spoke. */
  prompts: number;
  ticker: NodeJS.Timeout;
  ticking: boolean;
  /** A verdict is in (or the elder took the call back): Sonic is done and the closing line is playing. */
  closing: boolean;
}
const calls = new Map<string, Call>();
/** Agent TwiML waiting for Twilio to fetch it after a redirect, by one-time id. */
const turns = new Map<string, string>();

const log = (callSid: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), call: callSid.slice(-6), msg, ...extra }));

/** Texts the elder at the moments that change what they should do (red, takeover, agent done, call over). */
const texts = elderTexter({ tw, from: cfg.twilioNumber, to: cfg.elderPhone, webUrl: cfg.webUrl, dryRun: DRY_RUN, log });

// --- HTTP: Twilio webhooks --------------------------------------------------------

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('body too large');
  }
  return Object.fromEntries(new URLSearchParams(body));
}

/** Only Twilio, signing with our auth token, may hit the webhooks. */
function fromTwilio(req: IncomingMessage, params: Record<string, string>): boolean {
  const signature = req.headers['x-twilio-signature'];
  if (typeof signature !== 'string') return false;
  return twilio.validateRequest(cfg.authToken, signature, `${cfg.publicUrl}${req.url}`, params);
}

const send = (res: ServerResponse, status: number, body: string, type = 'text/xml') => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

async function trustedContacts(): Promise<string> {
  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: cfg.eldersTable, Key: { elderId: cfg.elderId } }));
    return [...cfg.trustedContacts, ...((Item?.trustedContacts as string[] | undefined) ?? [])].join(',');
  } catch (err) {
    console.error('trusted contacts read failed, using local list', err);
    return cfg.trustedContacts.join(',');
  }
}

async function onVoice(params: Record<string, string>, res: ServerResponse) {
  const callSid = params.CallSid;
  if (!callSid) return send(res, 400, 'missing CallSid', 'text/plain');

  // Product rule: only callers NOT in the elder's contacts are screened.
  if (isTrusted(params.From, await trustedContacts())) {
    log(callSid, 'trusted caller, ringing elder directly');
    return send(res, 200, directDial(cfg.elderPhone, cfg.dialFrom));
  }

  const call: Call = {
    callSid,
    token: randomUUID(),
    utterances: [],
    ingestChain: Promise.resolve(),
    agentStatus: 'idle',
    agentBusy: false,
    replyPending: false,
    mutedUntil: 0,
    tracks: {},
  };
  calls.set(callSid, call);
  log(callSid, 'unknown caller, screening');
  const mediaUrl = `${cfg.publicUrl.replace(/^http/, 'ws')}/media`;
  // Forward to the elder. On trial accounts the caller ID must be the assigned trial number.
  send(res, 200, screenedCall({ mediaUrl, token: call.token, callSid, elderPhone: cfg.elderPhone, callerId: cfg.dialFrom }));
}

/** Our own TwiML URLs during a takeover. The call's token in the path authorizes them. */
const turnUrl = (call: Call, id: string) => `${cfg.publicUrl}/turn/${call.callSid}/${call.token}/${id}`;
const idleUrl = (call: Call) => `${cfg.publicUrl}/idle/${call.callSid}/${call.token}`;

function onCallTwiml(path: string, res: ServerResponse) {
  const [, kind, sid, token, id] = path.split('/');
  const call = sid ? calls.get(sid) : undefined;
  // Always 200: an error status makes Twilio play its "application error" message.
  if (!call || token !== call.token) {
    console.warn(`${kind} refused: ${call ? 'bad token' : 'unknown call'}`);
    return send(res, 200, hangup());
  }
  if (kind === 'idle') return send(res, 200, idle(idleUrl(call)));
  const twiml = id ? turns.get(id) : undefined;
  if (id) turns.delete(id);
  send(res, 200, twiml ?? idle(idleUrl(call)));
}

createServer(async (req, res) => {
  const [path, query = ''] = (req.url ?? '/').split('?');
  res.on('finish', () => {
    if (path !== '/health') console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'http', method: req.method, path, status: res.statusCode }));
  });
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', 'text/plain');
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    // Twilio sends POST form bodies by default; GET puts the same params in the query (signed with the full URL).
    const params = req.method === 'POST' ? await readForm(req) : {};

    if (path.startsWith('/turn/') || path.startsWith('/idle/')) return onCallTwiml(path, res);

    if (!DRY_RUN && !fromTwilio(req, params)) {
      console.warn(
        `signature check failed for ${req.method} ${path}: expected URL ${cfg.publicUrl}${req.url}, ` +
          `host header ${req.headers.host}, params ${Object.keys(params).join(',')}`,
      );
      return send(res, 403, 'bad signature', 'text/plain');
    }
    if (req.method === 'GET') Object.assign(params, Object.fromEntries(new URLSearchParams(query)));
    if (path === '/voice') return await onVoice(params, res);
    if (path === '/status') {
      if (params.CallStatus === 'completed') endCall(params.CallSid, 'hung up');
      return send(res, 204, '');
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (err) {
    console.error('http error', err);
    send(res, 500, 'error', 'text/plain');
  }
})
  .on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/media' && path !== '/agent') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => (path === '/media' ? onMedia(ws) : onAgentStream(ws)));
  })
  .listen(cfg.port, () => {
    console.log(`Twilio bridge on :${cfg.port}${DRY_RUN ? ' (dry run)' : ''}, agent voice: ${cfg.agentVoice}, backend: ${backend ? 'in this process' : 'Lambda'}`);
    console.log(`  Voice webhook: ${cfg.publicUrl}/voice   Status callback: ${cfg.publicUrl}/status`);
  });

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// --- Media stream -------------------------------------------------------------------

interface TwilioMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  streamSid?: string;
  start?: { callSid: string; streamSid?: string; customParameters?: Record<string, string> };
  media?: { track: 'inbound' | 'outbound'; payload: string };
}

function onMedia(ws: WebSocket) {
  let call: Call | undefined;
  ws.on('message', (raw) => {
    let m: TwilioMessage;
    try {
      m = JSON.parse(raw.toString()) as TwilioMessage;
    } catch {
      return;
    }
    if (m.event === 'start') {
      const sid = m.start?.customParameters?.callSid ?? m.start?.callSid ?? '';
      const c = calls.get(sid);
      // The token was handed out in our own signed TwiML, so only that call's stream gets in.
      if (!c || m.start?.customParameters?.token !== c.token) {
        console.warn('media stream with unknown call or bad token, closing');
        return ws.close();
      }
      call = c;
      for (const speaker of ['caller', 'elder'] as const) startTrack(c, speaker);
      log(c.callSid, 'media stream started');
    } else if (m.event === 'media' && call && m.media) {
      const speaker = m.media.track === 'inbound' ? 'caller' : 'elder';
      const muted = speaker === 'elder' && Date.now() < call.mutedUntil;
      call.tracks[speaker]?.push(mulawToPcm16(Buffer.from(m.media.payload, 'base64')), muted);
    } else if (m.event === 'stop' && call) {
      // Logged with the agent state: if the stream stops when we redirect to the agent, this shows it.
      streamEnded(call, `stream stopped (agent ${call.agentStatus})`);
    }
  });
  ws.on('close', () => call && streamEnded(call, 'socket closed'));
}

/** The monitoring stream is gone, so the call is over, unless Nova Sonic's own stream has the caller. */
function streamEnded(call: Call, why: string) {
  if (call.sonic) return log(call.callSid, 'monitoring stream ended during the takeover', { why });
  endCall(call.callSid, why);
}

/** One Transcribe stream per track. If it drops (network reset, 4 h limit), open a new one. */
function startTrack(call: Call, speaker: 'caller' | 'elder', attempt = 0) {
  call.tracks[speaker] = startTrackTranscriber(
    transcribe,
    (text) => onSentence(call, speaker, text),
    (err) => {
      console.error(`transcribe ${speaker} failed (attempt ${attempt + 1})`, (err as Error).message ?? err);
      if (!calls.has(call.callSid) || attempt >= 5) return;
      setTimeout(() => calls.has(call.callSid) && startTrack(call, speaker, attempt + 1), 500);
    },
  );
}

function endCall(callSid: string | undefined, why: string) {
  const call = callSid ? calls.get(callSid) : undefined;
  if (!call) return;
  calls.delete(call.callSid);
  clearTimeout(call.agentTimer);
  clearTimeout(call.silenceTimer);
  call.tracks.caller?.stop();
  call.tracks.elder?.stop();
  if (call.sonic) {
    stopSonic(call, call.sonic);
    call.sonic.ws?.close();
  }
  log(call.callSid, 'call ended', { why, sentences: call.utterances.length });
  // Tell the app (Calls -> push) once the sentences still queued are scored, so it shows the final result.
  call.ingestChain = call.ingestChain.then(() => markEnded(call));
}

/** Calls.ended = true: the app closes the call and shows the summary. If the agent still had it, the caller left. */
async function markEnded(call: Call) {
  if (call.agentStatus === 'active') await setAgentStatus(call, 'active', 'caller_left', 'The call ended while the agent had it.');
  texts.update(call.callSid, { ended: true });
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: cfg.callsTable,
        Key: { callId: call.callSid },
        UpdateExpression: 'SET ended = :yes',
        ConditionExpression: 'attribute_exists(callId)', // no Calls item if nothing was said: nothing to tell the app
        ExpressionAttributeValues: { ':yes': true },
      }),
    );
  } catch (err) {
    if ((err as Error).name !== 'ConditionalCheckFailedException') console.error('marking the call ended failed', err);
  }
}

// --- Sentences -> IngestFn ---------------------------------------------------------------

function onSentence(call: Call, speaker: 'caller' | 'elder', text: string) {
  if (!calls.has(call.callSid)) return;
  // During a Nova Sonic takeover the caller's words come from Sonic's own transcript (recordLine).
  if (call.sonic) return;
  const ts = Date.now();
  call.utterances.push({ callId: call.callSid, elderId: cfg.elderId, speaker, text, ts, seq: call.utterances.length });
  log(call.callSid, 'sentence', { speaker, text });

  if (call.agentStatus === 'active') {
    // The caller is answering our agent: reply after they pause. IngestFn still records the line.
    if (speaker === 'caller') {
      clearTimeout(call.silenceTimer);
      clearTimeout(call.agentTimer);
      if (call.agentBusy) call.replyPending = true;
      else call.agentTimer = setTimeout(() => void agentTurn(call), AGENT_REPLY_DELAY_MS);
    }
  }
  // One IngestFn call at a time per call, so each sentence is scored on the previous state.
  const seq = call.utterances.length - 1;
  call.ingestChain = call.ingestChain.then(() => ingest(call, { callId: call.callSid, elderId: cfg.elderId, speaker, text, ts, seq }));
}

/** IngestFn: the deployed Lambda, or its code run here (LOCAL_BACKEND=1). */
async function invokeIngest(req: IngestRequest): Promise<RiskState | null> {
  if (backend) return backend.ingest(req);
  const res = await lambda.send(new InvokeCommand({ FunctionName: cfg.ingestFnName, Payload: Buffer.from(JSON.stringify(req)) }));
  const body = res.Payload ? new TextDecoder().decode(res.Payload) : 'null';
  if (res.FunctionError) throw new Error(`${res.FunctionError}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as RiskState | null;
}

/** The Agent Lambda (Claude Haiku) on the call so far: its next line and its verdict. */
async function askAgent(call: Call): Promise<AgentResponse> {
  const req = { callId: call.callSid, elderId: cfg.elderId, utterances: call.utterances };
  if (backend) return backend.agent(req);
  const res = await fetch(cfg.agentUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(`agent HTTP ${res.status}`);
  return (await res.json()) as AgentResponse;
}

async function ingest(call: Call, req: IngestRequest) {
  try {
    const state = await invokeIngest(req);
    if (!state) return; // the agent has the call, or this was the agent's own line
    log(call.callSid, 'risk', { level: state.level, risk: state.risk, tactics: state.tactics, elder: state.elderState, action: state.action });
    texts.update(call.callSid, { level: state.level });
    // Claim the call in Calls first: IngestFn pauses scoring and the app shows the takeover screen.
    if (state.action === 'agent_takeover' && call.agentStatus === 'idle' && (await setAgentStatus(call, 'idle', 'active'))) {
      call.agentStatus = 'active';
      texts.update(call.callSid, { agentStatus: 'active' });
      call.mutedUntil = Infinity; // the elder is about to be disconnected; outbound = our agent only
      if (cfg.agentVoice === 'sonic') void startSonicTakeover(call);
      else void agentTurn(call);
    }
  } catch (err) {
    console.error('ingest failed', err);
  }
}

// --- Agent takeover ----------------------------------------------------------------------

async function agentTurn(call: Call) {
  if (call.agentStatus !== 'active' || !calls.has(call.callSid)) return;
  if (call.agentBusy) {
    call.replyPending = true;
    return;
  }
  call.agentBusy = true;
  call.replyPending = false;
  const callerLinesAtRequest = call.utterances.filter((u) => u.speaker === 'caller').length;
  try {
    const a = await askAgent(call);
    if (call.agentStatus !== 'active') return;
    // The caller said more while we waited: this reply is stale, so ask again with the new lines.
    const callerLinesNow = call.utterances.filter((u) => u.speaker === 'caller').length;
    if (a.status === 'active' && callerLinesNow > callerLinesAtRequest) {
      call.replyPending = true;
      return;
    }

    // "Let me talk" in the app sets Calls.agentStatus to 'stopped': don't say another word.
    if (await elderTookCallBack(call)) return await handBack(call);

    if (a.say) {
      const ts = Date.now();
      const seq = call.utterances.length;
      call.utterances.push({ callId: call.callSid, elderId: cfg.elderId, speaker: 'agent', text: a.say, ts, seq });
      // Recorded through IngestFn (in order with the other sentences) so the app shows what the agent said.
      call.ingestChain = call.ingestChain.then(() => ingest(call, { callId: call.callSid, elderId: cfg.elderId, speaker: 'agent', text: a.say, ts, seq }));
    }
    // After the line: keep listening, ring the elder back (verified), or hang up (scam / caller gone).
    const then = a.status === 'active' ? 'listen' : a.status === 'verified' ? 'handback' : 'hangup';
    await speak(call, a.say, then);
    log(call.callSid, 'agent', { status: a.status, say: a.say });
    if (a.status !== 'active') return await finishAgent(call, a.status, a.say, a.summary);

    clearTimeout(call.silenceTimer);
    call.silenceTimer = setTimeout(() => void finishAgent(call, 'caller_left', '', 'The caller went quiet after the takeover.'), CALLER_SILENCE_MS);
  } catch (err) {
    console.error('agent turn failed', err);
  } finally {
    call.agentBusy = false;
    if (call.replyPending && call.agentStatus === 'active') {
      call.replyPending = false;
      clearTimeout(call.silenceTimer);
      call.agentTimer = setTimeout(() => void agentTurn(call), AGENT_REPLY_DELAY_MS);
    }
  }
}

/**
 * Say a line to the caller by redirecting their call to our TwiML. The first redirect of a takeover
 * also drops the elder's forwarded leg (a redirect ends the running <Dial>).
 */
async function speak(call: Call, text: string, then: 'listen' | 'handback' | 'hangup') {
  const ms = text ? speechMs(text) : 0;
  if (DRY_RUN) {
    log(call.callSid, 'would say', { text, then });
  } else {
    const id = randomUUID();
    turns.set(id, agentTwiml({ text, then, idleUrl: idleUrl(call), elderPhone: cfg.elderPhone, callerId: cfg.dialFrom }));
    setTimeout(() => turns.delete(id), 60_000);
    await tw.calls(call.callSid).update({ url: turnUrl(call, id) });
  }
  if (then === 'handback') call.mutedUntil = Date.now() + ms + 500; // the elder's voice counts again after the line
  await new Promise((r) => setTimeout(r, ms)); // let it finish before listening for the reply
}

/**
 * Move Calls.agentStatus from -> to (with the takeover summary when it ends). Returns false if it
 * wasn't `from`, e.g. the elder tapped "Let me talk" (stopped). IngestFn reads it: 'active' pauses
 * scoring, and a verified caller can't push the call back to red.
 */
async function setAgentStatus(call: Call, from: AgentStatus, to: AgentStatus, summary?: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: cfg.callsTable,
        Key: { callId: call.callSid },
        UpdateExpression: summary === undefined ? 'SET agentStatus = :to' : 'SET agentStatus = :to, agentSummary = :sum',
        ConditionExpression: 'agentStatus = :from',
        ExpressionAttributeValues: { ':from': from, ':to': to, ...(summary === undefined ? {} : { ':sum': summary }) },
      }),
    );
    return true;
  } catch (err) {
    if ((err as Error).name !== 'ConditionalCheckFailedException') console.error('saving agent status failed', err);
    return false;
  }
}

async function elderTookCallBack(call: Call): Promise<boolean> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: cfg.callsTable, Key: { callId: call.callSid }, ProjectionExpression: 'agentStatus' }),
  );
  return Item?.agentStatus === 'stopped';
}

/** The elder took the call back ("Let me talk"): the agent goes quiet and her phone rings again. */
async function handBack(call: Call) {
  clearTimeout(call.agentTimer);
  clearTimeout(call.silenceTimer);
  call.agentStatus = 'stopped';
  log(call.callSid, 'elder took the call back');
  try {
    await speak(call, '', 'handback');
  } catch (err) {
    console.error('ringing the elder back failed', err);
  }
}

async function finishAgent(call: Call, status: AgentStatus, lastLine: string, summary: string) {
  clearTimeout(call.agentTimer);
  clearTimeout(call.silenceTimer);
  // Only while the agent still has the call: if the elder took it back, that wins.
  if (!(await setAgentStatus(call, 'active', status, summary))) return await handBack(call);
  call.agentStatus = status;
  texts.update(call.callSid, { agentStatus: status });
  log(call.callSid, 'agent finished', { status, lastLine });
  // The TwiML from speak() already rang the elder back (verified) or hung up (scam / caller left).
  if (status === 'caller_left' && !DRY_RUN) {
    // Reached from the silence timer, which didn't go through speak(): end the call ourselves.
    await tw.calls(call.callSid).update({ status: 'completed' }).catch((err) => console.error('ending the call failed', err));
  }
}

// --- Agent takeover with Nova Sonic (AGENT_VOICE=sonic) ----------------------------------
// Sonic talks with the caller over a two-way stream and handles the turn-taking. It only talks:
// each caller reply goes to the Agent Lambda (Claude Haiku), which decides the verdict with the
// same guards as before; the closing line is then said with speak(), like the <Say> path.

/** After this much quiet from both sides, the agent asks whether the caller is still there (twice at most). */
const QUIET_PROMPT_MS = 8000;
const STILL_THERE = 'Hello? Are you still there?';
const QUIET_GOODBYE = "I can't hear you, so I'm going to hang up now. Goodbye.";
/** Sonic reports the caller's words in pieces; judge once they stop coming for this long. */
const JUDGE_DELAY_MS = 700;

/** The elder's settings, or the cdk.json persona. The verification answer is deliberately not read. */
async function persona(): Promise<SonicPersona> {
  const p = cfg.persona;
  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: cfg.eldersTable, Key: { elderId: cfg.elderId } }));
    return {
      elderName: Item?.elderName ?? p.elderName,
      agentName: Item?.agentName ?? p.agentName,
      agentRelation: Item?.agentRelation ?? p.agentRelation,
      verificationQuestion: Item?.verificationQuestion ?? p.verificationQuestion,
    };
  } catch (err) {
    console.error('elder settings read failed, using cdk.json', err);
    return p;
  }
}

/** Add a line Sonic heard or said to the transcript, and to Calls through IngestFn (the app shows agent lines). */
function recordLine(call: Call, speaker: 'caller' | 'agent', text: string) {
  const ts = Date.now();
  const seq = call.utterances.length;
  call.utterances.push({ callId: call.callSid, elderId: cfg.elderId, speaker, text, ts, seq });
  log(call.callSid, 'sentence', { speaker, text, voice: 'sonic' });
  call.ingestChain = call.ingestChain.then(() => ingest(call, { callId: call.callSid, elderId: cfg.elderId, speaker, text, ts, seq }));
}

async function startSonicTakeover(call: Call) {
  const p = await persona();
  const opening = openingLine(p);
  const before = [...call.utterances];
  recordLine(call, 'agent', opening);
  const t: SonicTakeover = {
    session: startSonic(cfg.region, sonicSystemPrompt(p, before), {
      onAudio: (pcm) => playToCaller(t, pcm),
      onText: (speaker, text) => onSonicText(call, t, speaker, text),
      onInterrupted: () => {
        // The caller talked over the agent: drop what Twilio hasn't played yet.
        if (t.ws && t.streamSid) t.ws.send(JSON.stringify({ event: 'clear', streamSid: t.streamSid }));
        t.speakingUntil = Date.now();
      },
      onClosed: (err) => {
        if (!err || t.closing || call.sonic !== t) return;
        console.error('Nova Sonic failed, falling back to <Say>', err);
        stopSonic(call, t);
        call.sonic = undefined;
        void agentTurn(call); // its redirect ends the two-way stream
      },
    }),
    agentText: '',
    judging: false,
    judgeAgain: false,
    speakingUntil: Date.now() + speechMs(opening),
    lastHeard: Date.now(),
    prompts: 0,
    ticker: setInterval(() => void sonicTick(call, t), 1000),
    ticking: false,
    closing: false,
  };
  call.sonic = t;
  try {
    if (DRY_RUN) {
      log(call.callSid, 'would say', { text: opening, then: 'agent stream' });
    } else {
      // Opening line, then the two-way stream. Redirecting the caller here drops the elder's forwarded leg.
      const id = randomUUID();
      const streamUrl = `${cfg.publicUrl.replace(/^http/, 'ws')}/agent`;
      turns.set(id, agentStream({ opening, streamUrl, token: call.token, callSid: call.callSid }));
      setTimeout(() => turns.delete(id), 60_000);
      await tw.calls(call.callSid).update({ url: turnUrl(call, id) });
    }
  } catch (err) {
    console.error('starting the agent stream failed, falling back to <Say>', err);
    stopSonic(call, t);
    call.sonic = undefined;
    void agentTurn(call);
  }
}

/** Twilio's two-way stream for a takeover: the caller's audio in, the agent's voice out. */
function onAgentStream(ws: WebSocket) {
  let call: Call | undefined;
  let t: SonicTakeover | undefined;
  ws.on('message', (raw) => {
    let m: TwilioMessage;
    try {
      m = JSON.parse(raw.toString()) as TwilioMessage;
    } catch {
      return;
    }
    if (m.event === 'start') {
      const c = calls.get(m.start?.customParameters?.callSid ?? m.start?.callSid ?? '');
      if (!c?.sonic || m.start?.customParameters?.token !== c.token) {
        console.warn('agent stream with unknown call or bad token, closing');
        return ws.close();
      }
      call = c;
      t = c.sonic;
      t.ws = ws;
      t.streamSid = m.start?.streamSid ?? m.streamSid;
      t.lastHeard = t.speakingUntil = Date.now(); // the opening line has just finished playing
      log(c.callSid, 'agent stream started');
    } else if (m.event === 'media' && t && m.media) {
      t.session.push(mulawToPcm16(Buffer.from(m.media.payload, 'base64')));
    }
  });
  ws.on('close', () => call && t && log(call.callSid, 'agent stream closed', { closing: t.closing }));
}

function playToCaller(t: SonicTakeover, pcm: Buffer) {
  if (t.closing || !t.ws || t.ws.readyState !== t.ws.OPEN || !t.streamSid) return;
  t.ws.send(JSON.stringify({ event: 'media', streamSid: t.streamSid, media: { payload: Buffer.from(pcm16ToMulaw(pcm)).toString('base64') } }));
  t.speakingUntil = Math.max(Date.now(), t.speakingUntil) + (pcm.length / 2 / 8000) * 1000;
}

function onSonicText(call: Call, t: SonicTakeover, speaker: 'caller' | 'agent', text: string) {
  if (t.closing || !text.trim()) return;
  if (speaker === 'agent') {
    // Sonic sends a turn sentence by sentence; keep it as one line (the Agent Lambda caps agent lines).
    t.agentText += `${t.agentText ? ' ' : ''}${text.trim()}`;
    clearTimeout(t.flushTimer);
    t.flushTimer = setTimeout(() => flushAgentText(call, t), 1500);
    return;
  }
  flushAgentText(call, t);
  recordLine(call, 'caller', text.trim());
  t.lastHeard = Date.now();
  t.prompts = 0;
  clearTimeout(t.judgeTimer);
  t.judgeTimer = setTimeout(() => void judge(call, t), JUDGE_DELAY_MS);
}

function flushAgentText(call: Call, t: SonicTakeover) {
  clearTimeout(t.flushTimer);
  if (!t.agentText) return;
  recordLine(call, 'agent', t.agentText);
  t.agentText = '';
}

/** Claude Haiku (the Agent Lambda) reads the transcript and decides; the line it would say is only used to close. */
async function judge(call: Call, t: SonicTakeover) {
  if (t.closing || call.agentStatus !== 'active') return;
  if (t.judging) {
    t.judgeAgain = true;
    return;
  }
  t.judging = true;
  try {
    const a = await askAgent(call);
    log(call.callSid, 'verdict', { status: a.status });
    if (a.status !== 'active' && !t.closing && call.agentStatus === 'active') await closeSonicTakeover(call, t, a.status, a.say, a.summary);
  } catch (err) {
    console.error('judging the takeover failed', err);
  } finally {
    t.judging = false;
    if (t.judgeAgain && !t.closing) {
      t.judgeAgain = false;
      void judge(call, t);
    }
  }
}

/** Once a second during the takeover: "Let me talk" from the app, and a caller who has gone quiet. */
async function sonicTick(call: Call, t: SonicTakeover) {
  if (t.ticking || t.closing || call.agentStatus !== 'active') return;
  t.ticking = true;
  try {
    if (await elderTookCallBack(call)) {
      t.closing = true;
      stopSonic(call, t);
      await handBack(call); // the redirect to the elder ends the two-way stream
      t.ws?.close();
      call.sonic = undefined;
      return;
    }
    if (!t.ws || Date.now() - Math.max(t.lastHeard, t.speakingUntil) < QUIET_PROMPT_MS) return;
    if (t.prompts >= 2) return await closeSonicTakeover(call, t, 'caller_left', QUIET_GOODBYE, 'The caller went quiet after the takeover.');
    t.prompts++;
    flushAgentText(call, t);
    recordLine(call, 'agent', STILL_THERE);
    playToCaller(t, await stillThere());
  } catch (err) {
    console.error('takeover check failed', err);
  } finally {
    t.ticking = false;
  }
}

let stillThereAudio: Promise<Buffer> | undefined;
/** "Are you still there?" in the agent's voice, as 8 kHz PCM (Sonic only speaks in reply to the caller). */
function stillThere(): Promise<Buffer> {
  stillThereAudio ??= polly
    .send(new SynthesizeSpeechCommand({ Text: STILL_THERE, VoiceId: 'Matthew', Engine: 'neural', OutputFormat: 'pcm', SampleRate: '8000' }))
    .then(async (r) => Buffer.from(await r.AudioStream!.transformToByteArray()));
  return stillThereAudio;
}

function stopSonic(call: Call, t: SonicTakeover) {
  clearInterval(t.ticker);
  clearTimeout(t.flushTimer);
  clearTimeout(t.judgeTimer);
  t.session.close();
  log(call.callSid, 'Nova Sonic stopped');
}

/** A verdict is in: Sonic goes quiet, the closing line is said, and the call is handed back or ended. */
async function closeSonicTakeover(call: Call, t: SonicTakeover, status: AgentStatus, say: string, summary: string) {
  t.closing = true;
  stopSonic(call, t);
  flushAgentText(call, t);
  if (say) recordLine(call, 'agent', say);
  log(call.callSid, 'agent', { status, say, voice: 'sonic' });
  try {
    // Ring the elder back (verified) or hang up. The redirect ends the two-way stream.
    await speak(call, say, status === 'verified' ? 'handback' : 'hangup');
  } catch (err) {
    console.error('closing line failed', err);
  }
  t.ws?.close();
  await finishAgent(call, status, say, summary);
  call.sonic = undefined; // only now: until then the monitoring stream's sentences are ignored
}
