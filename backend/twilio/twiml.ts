// TwiML builders. VoiceResponse escapes everything, so agent text can't inject XML.
// Trial-safe: no conferences, no `method` attributes (trial accounts reject or ignore them).
import twilio from 'twilio';

const { VoiceResponse } = twilio.twiml;
/** Twilio's Amazon Polly voice for the agent ("Mike"). */
export const AGENT_VOICE = 'Polly.Matthew-Neural';
/** How long an idle agent leg waits before re-fetching itself (keeps the caller on the line). */
const IDLE_SECONDS = 20;

type Twiml = InstanceType<typeof VoiceResponse>;

/** Ring the elder. `callerId` must be the trial account's assigned number on trial accounts. */
function dialElder(r: Twiml, elderPhone: string, callerId?: string) {
  const dial = r.dial(callerId ? { callerId } : {});
  dial.number(elderPhone);
}

/** Trusted caller: ring the elder directly, no streaming or analysis. */
export function directDial(elderPhone: string, callerId?: string): string {
  const r = new VoiceResponse();
  dialElder(r, elderPhone, callerId);
  return r.toString();
}

/**
 * Unknown caller: stream both audio tracks to our server, then forward the call to the elder.
 * Inbound track = the caller; outbound track = what the caller hears (the elder, later our agent).
 * The stream started with <Start> keeps running when we later redirect the call to the agent.
 */
export function screenedCall(opts: { mediaUrl: string; token: string; callSid: string; elderPhone: string; callerId?: string }): string {
  const r = new VoiceResponse();
  const stream = r.start().stream({ url: opts.mediaUrl, track: 'both_tracks' });
  stream.parameter({ name: 'token', value: opts.token });
  stream.parameter({ name: 'callSid', value: opts.callSid });
  dialElder(r, opts.elderPhone, opts.callerId);
  return r.toString();
}

/**
 * The agent's turn on the caller's leg (the elder has been disconnected by the redirect).
 * then = 'listen': say the line, then wait for the caller's reply (idleUrl loops to keep the call up).
 * then = 'handback': say the line, then ring the elder again.
 * then = 'hangup': say the goodbye and end the call.
 */
export function agentTurn(opts: {
  text: string;
  then: 'listen' | 'handback' | 'hangup';
  idleUrl: string;
  elderPhone: string;
  callerId?: string;
}): string {
  const r = new VoiceResponse();
  if (opts.text) r.say({ voice: AGENT_VOICE }, opts.text);
  if (opts.then === 'listen') {
    r.pause({ length: IDLE_SECONDS });
    r.redirect(opts.idleUrl);
  } else if (opts.then === 'handback') {
    dialElder(r, opts.elderPhone, opts.callerId);
  } else {
    r.hangup();
  }
  return r.toString();
}

/**
 * Takeover with Nova Sonic: say the opening line, then connect the caller to a two-way stream
 * (our /agent WebSocket) that carries the caller's voice in and the agent's voice out.
 * Like agentTurn, redirecting the caller here disconnects the elder.
 */
export function agentStream(opts: { opening: string; streamUrl: string; token: string; callSid: string }): string {
  const r = new VoiceResponse();
  r.say({ voice: AGENT_VOICE }, opts.opening);
  const stream = r.connect().stream({ url: opts.streamUrl });
  stream.parameter({ name: 'token', value: opts.token });
  stream.parameter({ name: 'callSid', value: opts.callSid });
  return r.toString();
}

/** Keeps the caller on the line while the agent waits for a reply. */
export function idle(idleUrl: string): string {
  const r = new VoiceResponse();
  r.pause({ length: IDLE_SECONDS });
  r.redirect(idleUrl);
  return r.toString();
}

export const hangup = (): string => new VoiceResponse().hangup().toString();
