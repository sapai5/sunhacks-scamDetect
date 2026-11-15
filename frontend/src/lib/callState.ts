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

export const VIEW_LABEL: Record<ElderView, string> = {
  listening: 'Listening',
  green: 'Safe',
  yellow: 'Careful',
  verifying: 'Checking',
  red: 'Scam',
};
