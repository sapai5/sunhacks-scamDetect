// Maps backend risk state to the elder screen to show (Figma E1a–E5).
import type { PushMessage, RiskState, Verification } from '../../../contracts/index.js';

export type ElderView = 'listening' | 'green' | 'yellow' | 'verifying' | 'red';

/**
 * "verifying" (the blue Checking screen) isn't a backend level: it's yellow +
 * ask_verification while the elder hasn't answered yet.
 */
export function elderView(risk: RiskState | null, verification: Verification): ElderView {
  if (!risk) return 'listening';
  if (risk.level === 'red') return 'red';
  if (risk.action === 'ask_verification' && verification === 'unasked') return 'verifying';
  return risk.level;
}

/** A phone call on screen with no new result for this long can be replaced by another phone call. */
export const PHONE_CALL_QUIET_MS = 60_000;

/**
 * What a message pushed for a phone call does to the call on screen:
 * - 'new': start showing it (nothing running, or the phone call on screen has gone quiet)
 * - 'update': it's the call on screen, with a newer or the same RiskState (agent progress and
 *   the hang-up arrive with the RiskState unchanged); `ended` then closes it
 * - 'ignore': a call that already ended and isn't on screen, a running speakerphone/demo call,
 *   another phone call that's still active, a call the elder already closed, or an older RiskState
 */
export function pushedStateEffect(
  current: { callId: string; running: boolean; phone: boolean; risk: RiskState | null },
  next: PushMessage,
): 'new' | 'update' | 'ignore' {
  if (current.callId !== next.callId) {
    if (next.ended || (current.running && !current.phone)) return 'ignore';
    if (!current.running) return 'new';
    // The other call's hang-up push frees the screen; "quiet for 60 s" covers one that never arrives.
    const quiet = !current.risk || next.updatedAt - current.risk.updatedAt > PHONE_CALL_QUIET_MS;
    return quiet ? 'new' : 'ignore';
  }
  if (!current.running || (current.risk && next.updatedAt < current.risk.updatedAt)) return 'ignore';
  return 'update';
}

export const VIEW_LABEL: Record<ElderView, string> = {
  listening: 'Listening',
  green: 'Safe',
  yellow: 'Careful',
  verifying: 'Checking',
  red: 'Scam',
};
