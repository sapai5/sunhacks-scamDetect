// Maps backend risk state to the elder screen to show (Figma E1a–E5).
import type { RiskState, Verification } from '../../../contracts/index.js';

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
 * What a RiskState pushed for a phone call does to the call on screen:
 * - 'new': start showing it (nothing running, or the phone call on screen has gone quiet)
 * - 'update': it's the call on screen and newer than what's shown
 * - 'ignore': a speakerphone/demo call is running, another phone call is still active,
 *   the elder already ended this call, or it's stale
 */
export function pushedStateEffect(
  current: { callId: string; running: boolean; phone: boolean; risk: RiskState | null },
  next: RiskState,
): 'new' | 'update' | 'ignore' {
  if (current.callId !== next.callId) {
    if (!current.running) return 'new';
    if (!current.phone) return 'ignore';
    // ponytail: there's no end-of-call push yet, so "quiet for 60 s" stands in for "ended"; add one when Track A can send it.
    const quiet = !current.risk || next.updatedAt - current.risk.updatedAt > PHONE_CALL_QUIET_MS;
    return quiet ? 'new' : 'ignore';
  }
  if (!current.running || (current.risk && next.updatedAt <= current.risk.updatedAt)) return 'ignore';
  return 'update';
}

export const VIEW_LABEL: Record<ElderView, string> = {
  listening: 'Listening',
  green: 'Safe',
  yellow: 'Careful',
  verifying: 'Checking',
  red: 'Scam',
};
