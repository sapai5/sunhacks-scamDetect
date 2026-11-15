// The Figma dashboard talks in four scam stages. The backend returns nine tactics.
// This maps one onto the other so the Stage/Tracker and tactic chips can show backend data.
import type { Tactic } from '../../../contracts/index.js';

export const STAGES = ['claim', 'pressure', 'isolation', 'extraction'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  claim: 'Claim',
  pressure: 'Pressure',
  isolation: 'Isolation',
  extraction: 'Extraction',
};

export const TACTIC_STAGE: Record<Tactic, Stage> = {
  impersonation: 'claim',
  urgency: 'pressure',
  threats: 'pressure',
  secrecy: 'isolation',
  payment_request: 'extraction',
  gift_cards: 'extraction',
  wire_or_crypto: 'extraction',
  remote_access: 'extraction',
  personal_info_request: 'extraction',
};

export function stagesOf(tactics: readonly Tactic[]): Set<Stage> {
  return new Set(tactics.map((t) => TACTIC_STAGE[t]));
}

export const tacticLabel = (t: Tactic) => t.replaceAll('_', ' ');

/** Backend thresholds (backend/lambda/analyze/rules.ts): red needs risk >= 60 and 2+ tactics; yellow from 40 or 1 tactic. */
export const RISK_RED = 60;
export const RISK_YELLOW = 40;
