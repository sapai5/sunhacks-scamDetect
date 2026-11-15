// Offline stand-in for the Analyze Lambda. A keyword heuristic replaces Bedrock,
// but the level rules are the real ones from the Lambda (rules.ts), so the light
// behaves the same way: hysteresis, verification, alert only on entering red.
import type { AnalyzeRequest, RiskState, Tactic } from '@contracts';
import { decide, recentWindow, type ModelVerdict } from '@backend/lambda/analyze/rules';
import type { AnalyzeClient } from '../types';

const PATTERNS: Record<Tactic, RegExp> = {
  impersonation: /\b(it'?s me|your (grand(son|daughter)|nephew|niece)|this is (the )?(irs|social security|police|microsoft|apple|amazon|your bank))\b/i,
  urgency: /\b(right now|immediately|today|hurry|urgent|as soon as|before (it'?s too late|tonight))\b/i,
  secrecy: /\b(don'?t tell|keep (this|it) (between|secret|quiet)|our (little )?secret)\b/i,
  // Someone asking *you* for money; a routine "your payment is due" shouldn't match.
  payment_request: /(\b(need|send|bring|get|owe)\b[^.?!]*(\$\d|\bdollars\b|\bmoney\b|\bcash\b)|\bbail\b|\bprocessing fee\b)/i,
  gift_cards: /\b(gift ?cards?|itunes|google play|steam card)\b/i,
  wire_or_crypto: /\b(wire|bitcoin|crypto|western union|moneygram|zelle)\b/i,
  remote_access: /\b(anydesk|teamviewer|remote access|install (this|the|an?) (app|program|software)|let me (into|access) your computer)\b/i,
  personal_info_request: /\b(social security number|ssn|password|pin|account number|date of birth|read me the numbers|verify your (identity|account))\b/i,
  threats: /\b(arrest(ed)?|jail|warrant|lawsuit|deport|suspend(ed)?|locked out)\b/i,
};
const CLAIMED_RELATIVE = /\b(grandma|grandpa|grandmother|grandfather|it'?s me|your grand(son|daughter))\b/i;

export interface MockAnalyzeOptions {
  verificationQuestion?: string;
  latencyMs?: number;
}

export function mockVerdict(text: string): ModelVerdict {
  const tactics = (Object.keys(PATTERNS) as Tactic[]).filter((t) => PATTERNS[t].test(text));
  const claimedRelative = CLAIMED_RELATIVE.test(text);
  const risk = Math.min(100, tactics.length * 25 + (claimedRelative ? 10 : 0));
  const reason = tactics.length
    ? `Heard signs of ${tactics.map((t) => t.replaceAll('_', ' ')).join(', ')}.`
    : 'Nothing worrying so far.';
  return { risk, tactics, reason, claimedRelative };
}

export function createMockAnalyzeClient({
  verificationQuestion = 'What did we name the family dog when you were little?',
  latencyMs = 350,
}: MockAnalyzeOptions = {}): AnalyzeClient {
  return {
    async analyze(req: AnalyzeRequest): Promise<RiskState> {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const window = recentWindow(req.utterances);
      const verdict = mockVerdict(window.map((u) => u.text).join(' '));
      const d = decide(verdict, req);
      return {
        callId: req.callId,
        risk: d.risk,
        level: d.level,
        tactics: d.tactics,
        reason: window.length ? verdict.reason : '',
        action: d.action,
        updatedAt: Date.now(),
        calmStreak: d.calmStreak,
        claimedRelative: verdict.claimedRelative,
        verificationQuestion: d.action === 'ask_verification' ? verificationQuestion : undefined,
        // Mock "texts" the family the same way the Lambda would: on entering red.
        familyAlerted: d.shouldAlert,
      };
    },
  };
}
