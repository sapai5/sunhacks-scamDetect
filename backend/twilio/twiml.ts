// TwiML builders. VoiceResponse escapes everything, so agent text can't inject XML.
import twilio from 'twilio';

const { VoiceResponse } = twilio.twiml;
/** Twilio's Amazon Polly voice for the agent ("Mike"). */
export const AGENT_VOICE = 'Polly.Matthew-Neural';

/** Trusted caller: ring the elder directly, no streaming or analysis. */
export function directDial(elderPhone: string): string {
  const r = new VoiceResponse();
  r.dial(elderPhone);
  return r.toString();
}

/**
 * Unknown caller: stream both audio tracks to our server, then put the caller in a
 * conference named after their call. The elder is dialed into the same conference,
 * which lets the agent speak to everyone on the call with a conference announcement.
 */
export function screenedCall(opts: { mediaUrl: string; token: string; callSid: string; conference: string }): string {
  const r = new VoiceResponse();
  const stream = r.start().stream({ url: opts.mediaUrl, track: 'both_tracks' });
  stream.parameter({ name: 'token', value: opts.token });
  stream.parameter({ name: 'callSid', value: opts.callSid });
  r.dial().conference(
    { startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false', waitUrl: '' },
    opts.conference,
  );
  return r.toString();
}

/** The elder's leg: join the caller's conference. */
export function elderLeg(conference: string): string {
  const r = new VoiceResponse();
  r.dial().conference({ startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false' }, conference);
  return r.toString();
}

/** An agent line, played into the conference by an announcement. */
export function sayLine(text: string): string {
  const r = new VoiceResponse();
  r.say({ voice: AGENT_VOICE }, text);
  return r.toString();
}
