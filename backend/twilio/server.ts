// Twilio bridge: the phone path while Amazon Connect waits for its phone number quota.
//
//   caller -> Twilio number -> POST /voice
//     trusted caller   -> <Dial> the elder directly (no streaming)
//     unknown caller   -> <Start><Stream both_tracks> to /media, caller + elder in one conference
//   /media WebSocket   -> mu-law -> PCM -> Transcribe (one stream per track)
//     inbound track  = caller, outbound track = what the caller hears = elder (and our agent)
//   each final sentence -> IngestFn (Track B) -> RiskState, saved in Calls, pushed to the app
//   agent_takeover     -> Agent Lambda -> line spoken into the conference with Polly (announce)
//
// Run: npm run twilio -w backend   (see backend/twilio/README.md)
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import twilio from 'twilio';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentResponse, AgentStatus, IngestRequest, RiskState, Utterance } from '../../contracts/index.js';
import { isTrusted } from '../telephony/contacts-check/index.js';
import { mulawToPcm16, speechMs } from './audio.js';
import { loadConfig } from './config.js';
import { startTrackTranscriber, type TrackTranscriber } from './transcriber.js';
import { directDial, elderLeg, sayLine, screenedCall } from './twiml.js';

const cfg = await loadConfig();
const DRY_RUN = process.env.TWILIO_DRY_RUN === '1'; // local simulation: no Twilio REST calls
/** Phone speech gets split into short sentences ("Uncle Mike?" "Oh, hey."), so wait a bit longer than in the app. */
const AGENT_REPLY_DELAY_MS = 2000;
const CALLER_SILENCE_MS = 25_000;

const tw = twilio(cfg.accountSid, cfg.authToken);
const lambda = new LambdaClient({ region: cfg.region });
const transcribe = new TranscribeStreamingClient({ region: cfg.region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.region }));

interface Call {
  callSid: string;
  conference: string;
  token: string;
  utterances: Utterance[];
  ingestChain: Promise<void>;
  agentStatus: AgentStatus;
  agentBusy: boolean;
  /** The caller spoke while the agent was busy: answer once when it's free. */
  replyPending: boolean;
  agentTimer?: NodeJS.Timeout;
  silenceTimer?: NodeJS.Timeout;
  /** Outbound audio (elder side) is replaced with silence until then: it's our agent talking. */
  mutedUntil: number;
  tracks: Partial<Record<'caller' | 'elder', TrackTranscriber>>;
}
const calls = new Map<string, Call>();
/** Agent lines waiting for Twilio to fetch them as announcement TwiML. */
const lines = new Map<string, string>();

const log = (callSid: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), call: callSid.slice(-6), msg, ...extra }));

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
    return send(res, 200, directDial(cfg.elderPhone));
  }

  const call: Call = {
    callSid,
    conference: `scamshield-${callSid}`,
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
  send(res, 200, screenedCall({ mediaUrl, token: call.token, callSid, conference: call.conference }));

  // Ring the elder into the same conference.
  if (DRY_RUN) return;
  try {
    await tw.calls.create({ to: cfg.elderPhone, from: cfg.twilioNumber, twiml: elderLeg(call.conference), timeout: 30 });
  } catch (err) {
    console.error('dialing the elder failed', err);
  }
}

function onAnnounce(id: string, res: ServerResponse) {
  const text = lines.get(id);
  lines.delete(id);
  send(res, text ? 200 : 404, text ? sayLine(text) : '<Response/>');
}

createServer(async (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', 'text/plain');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed', 'text/plain');
    const params = await readForm(req);
    if (!DRY_RUN && !fromTwilio(req, params)) return send(res, 403, 'bad signature', 'text/plain');
    if (path === '/voice') return await onVoice(params, res);
    if (path.startsWith('/announce/')) return onAnnounce(path.slice('/announce/'.length), res);
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
    if ((req.url ?? '').split('?')[0] !== '/media') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => onMedia(ws));
  })
  .listen(cfg.port, () => {
    console.log(`Twilio bridge on :${cfg.port}${DRY_RUN ? ' (dry run)' : ''}`);
    console.log(`  Voice webhook: ${cfg.publicUrl}/voice   Status callback: ${cfg.publicUrl}/status`);
  });

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// --- Media stream -------------------------------------------------------------------

interface TwilioMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  start?: { callSid: string; customParameters?: Record<string, string> };
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
      endCall(call.callSid, 'stream stopped');
    }
  });
  ws.on('close', () => call && endCall(call.callSid, 'socket closed'));
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
  log(call.callSid, 'call ended', { why, sentences: call.utterances.length });
}

// --- Sentences -> IngestFn ---------------------------------------------------------------

function onSentence(call: Call, speaker: 'caller' | 'elder', text: string) {
  if (!calls.has(call.callSid)) return;
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
  call.ingestChain = call.ingestChain.then(() => ingest(call, { callId: call.callSid, elderId: cfg.elderId, speaker, text, ts }));
}

async function ingest(call: Call, req: IngestRequest) {
  try {
    const res = await lambda.send(
      new InvokeCommand({ FunctionName: cfg.ingestFnName, Payload: Buffer.from(JSON.stringify(req)) }),
    );
    const body = res.Payload ? new TextDecoder().decode(res.Payload) : 'null';
    if (res.FunctionError) throw new Error(`${res.FunctionError}: ${body.slice(0, 300)}`);
    const state = JSON.parse(body) as RiskState | null;
    if (!state) return; // the agent has the call
    log(call.callSid, 'risk', { level: state.level, risk: state.risk, tactics: state.tactics, elder: state.elderState, action: state.action });
    if (state.action === 'agent_takeover' && call.agentStatus === 'idle') {
      call.agentStatus = 'active';
      void agentTurn(call);
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
    const res = await fetch(cfg.agentUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: call.callSid, elderId: cfg.elderId, utterances: call.utterances }),
    });
    if (!res.ok) throw new Error(`agent HTTP ${res.status}`);
    const a = (await res.json()) as AgentResponse;
    if (call.agentStatus !== 'active') return;
    // The caller said more while we waited: this reply is stale, so ask again with the new lines.
    const callerLinesNow = call.utterances.filter((u) => u.speaker === 'caller').length;
    if (a.status === 'active' && callerLinesNow > callerLinesAtRequest) {
      call.replyPending = true;
      return;
    }

    if (a.say) {
      call.utterances.push({ callId: call.callSid, elderId: cfg.elderId, speaker: 'agent', text: a.say, ts: Date.now(), seq: call.utterances.length });
      await speak(call, a.say);
    }
    log(call.callSid, 'agent', { status: a.status, say: a.say });
    if (a.status !== 'active') return await finishAgent(call, a.status, a.say);

    clearTimeout(call.silenceTimer);
    call.silenceTimer = setTimeout(() => void finishAgent(call, 'caller_left', ''), CALLER_SILENCE_MS);
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

/** Speak into the conference so both the caller and the elder hear the agent. */
async function speak(call: Call, text: string) {
  const ms = speechMs(text);
  call.mutedUntil = Date.now() + ms + 500;
  if (DRY_RUN) {
    log(call.callSid, 'would say', { text });
    return void (await new Promise((r) => setTimeout(r, ms))); // same timing as a real announcement
  }
  const id = randomUUID();
  lines.set(id, text);
  setTimeout(() => lines.delete(id), 60_000);
  const [conf] = await tw.conferences.list({ friendlyName: call.conference, status: 'in-progress', limit: 1 });
  if (!conf) throw new Error('conference not found');
  await tw.conferences(conf.sid).update({ announceUrl: `${cfg.publicUrl}/announce/${id}`, announceMethod: 'POST' });
  await new Promise((r) => setTimeout(r, ms)); // let it finish before listening for the reply
}

async function finishAgent(call: Call, status: AgentStatus, lastLine: string) {
  clearTimeout(call.agentTimer);
  clearTimeout(call.silenceTimer);
  call.agentStatus = status;
  // Tell IngestFn: a verified caller can't push the call back to red; any other end stops re-takeover.
  try {
    await ddb.send(
      new UpdateCommand({ TableName: cfg.callsTable, Key: { callId: call.callSid }, UpdateExpression: 'SET agentStatus = :s', ExpressionAttributeValues: { ':s': status } }),
    );
  } catch (err) {
    console.error('saving agent status failed', err);
  }
  log(call.callSid, 'agent finished', { status });
  // Scam confirmed: after the goodbye, end the call for everyone.
  if (status === 'scam_confirmed' && !DRY_RUN) {
    await new Promise((r) => setTimeout(r, lastLine ? 500 : 0));
    try {
      const [conf] = await tw.conferences.list({ friendlyName: call.conference, status: 'in-progress', limit: 1 });
      if (conf) await tw.conferences(conf.sid).update({ status: 'completed' });
    } catch (err) {
      console.error('ending the call failed', err);
    }
  }
}
