// Shared contracts between the web app and the Analyze Lambda.
// See the design doc, "Data model and contracts".

export const TACTICS = [
  'impersonation',
  'urgency',
  'secrecy',
  'payment_request',
  'gift_cards',
  'wire_or_crypto',
  'remote_access',
  'personal_info_request',
  'threats',
] as const;
export type Tactic = (typeof TACTICS)[number];

export const LEVELS = ['green', 'yellow', 'red'] as const;
export type Level = (typeof LEVELS)[number];

export type Action = 'none' | 'ask_verification' | 'alert_family';

/** Whether the elder has asked the verification question, and the result. */
export const VERIFICATIONS = ['unasked', 'passed', 'failed'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/** One finished sentence. */
export interface Utterance {
  callId: string;
  elderId: string;
  speaker: string;
  text: string;
  ts: number;
  seq: number;
}

/**
 * Stage 1 request body (app -> Analyze Lambda). The browser holds all call
 * state and sends it each time, so the Lambda stays stateless.
 */
export interface AnalyzeRequest {
  callId: string;
  elderId: string;
  /** Transcript so far. The Lambda only scores the last ~60 s. */
  utterances: Utterance[];
  prevLevel: Level;
  calmStreak: number;
  verification: Verification;
}

/** Risk state (Analyze Lambda -> app). */
export interface RiskState {
  callId: string;
  risk: number;
  level: Level;
  tactics: Tactic[];
  reason: string;
  action: Action;
  updatedAt: number;
  // Stage 1 additions so the app can carry state between requests.
  calmStreak: number;
  claimedRelative: boolean;
  verificationQuestion?: string;
  familyAlerted: boolean;
}
