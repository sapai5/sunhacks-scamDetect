// Pure logic for the Events Lambda: validate a call event and decide whether (and what) to
// text the family. No AWS imports so it can be unit tested.
import { CALL_EVENT_TYPES, LEVELS, type CallEventRequest, type CallEventSource, type Level } from '../../../contracts/index.js';

export class BadRequest extends Error {}

const SOURCES: CallEventSource[] = ['elder', 'audio', 'transcript'];

export function parseEventRequest(body: unknown): CallEventRequest {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (typeof b.callId !== 'string' || !b.callId || b.callId.length > 64) throw new BadRequest('callId must be a string');
  if (!(CALL_EVENT_TYPES as readonly string[]).includes(b.type as string)) throw new BadRequest(`type must be one of ${CALL_EVENT_TYPES.join(', ')}`);
  return {
    callId: b.callId,
    type: b.type as CallEventRequest['type'],
    source: SOURCES.includes(b.source as CallEventSource) ? (b.source as CallEventSource) : 'elder',
    level: (LEVELS as readonly string[]).includes(b.level as string) ? (b.level as Level) : 'green',
    at: Number.isFinite(b.at) ? Number(b.at) : Date.now(),
    detail: typeof b.detail === 'string' ? b.detail.slice(0, 120) : undefined,
  };
}

/**
 * Text the family only when it changes what they should do:
 * - off speaker during a yellow/red call: we can no longer hear it, call them now (urgent)
 * - hang-up during a red call: reassurance (the Agent Lambda emails its own summary)
 * Everything else (green calls, speaker back on, the caller *asking* for off-speaker) is
 * recorded but not texted, so the family isn't spammed.
 */
export function familyMessage(e: CallEventRequest, elderName: string): string | null {
  if (e.type === 'speaker_off' && e.level !== 'green') {
    const what = e.level === 'red' ? 'a likely scam call' : 'a suspicious call';
    return `ScamDetermine: ${elderName} may have taken ${what} off speaker, so we can no longer hear it. Please call ${elderName} now.`;
  }
  if (e.type === 'hangup' && e.level === 'red') {
    return `ScamDetermine update: ${elderName} hung up on the likely scam call. You may want to check in.`;
  }
  return null;
}
