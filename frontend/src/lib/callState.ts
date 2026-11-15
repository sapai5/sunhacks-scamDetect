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

/**
 * What a RiskState pushed for a phone call does to the call on screen:
 * - 'new': start showing it (nothing running, or another phone call is showing)
 * - 'update': it's the call on screen and newer than what's shown
 * - 'ignore': a speakerphone/demo call is running, the elder already ended this call, or it's stale
 */
export function pushedStateEffect(
  current: { callId: string; running: boolean; phone: boolean; risk: RiskState | null },
  next: RiskState,
): 'new' | 'update' | 'ignore' {
  if (current.callId !== next.callId) return current.running && !current.phone ? 'ignore' : 'new';
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
