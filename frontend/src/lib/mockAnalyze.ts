// Offline stand-in for the Analyze Lambda so the UI works with no AWS.
// Keyword matching replaces Bedrock; the real level rules (backend rules.ts) decide the level.
import type { AnalyzeRequest, RiskState, Tactic } from '../../../contracts/index.js';
import { decide, recentWindow, type ModelVerdict } from '../../../backend/lambda/analyze/rules.js';

const PATTERNS: [Tactic, RegExp][] = [
  ['impersonation', /\b(it'?s me|grandson|granddaughter|from the (irs|bank|police)|social security office)\b/i],
  ['urgency', /\b(right now|today|immediately|trouble|jail|bail|accident|hurry)\b/i],
  ['secrecy', /\b(don'?t tell|keep this between|secret)\b/i],
  ['payment_request', /\b(dollars|pay|money|\$\d+)\b/i],
  ['gift_cards', /\bgift ?cards?\b/i],
  ['wire_or_crypto', /\b(wire|bitcoin|crypto|western union|zelle)\b/i],
  ['remote_access', /\b(remote|teamviewer|anydesk|your computer)\b/i],
  ['personal_info_request', /\b(social security number|password|account number|pin)\b/i],
  ['threats', /\b(arrest|warrant|lawsuit|deport)\b/i],
];
const RELATIVE = /\b(grandma|grandpa|grandson|granddaughter|it'?s me)\b/i;

export const VERIFICATION_QUESTION = "What was Grandpa's old dog's name?";

export async function mockAnalyze(req: AnalyzeRequest): Promise<RiskState> {
  await new Promise((r) => setTimeout(r, 300)); // feel like a network call
  const text = recentWindow(req.utterances).map((u) => u.text).join(' ');
  const tactics = PATTERNS.filter(([, re]) => re.test(text)).map(([t]) => t);
  const verdict: ModelVerdict = {
    risk: Math.min(100, tactics.length * 25),
    tactics,
    reason: tactics.length ? `Mock: heard ${tactics.join(', ').replaceAll('_', ' ')}.` : '',
    claimedRelative: RELATIVE.test(text),
  };
  const d = decide(verdict, req);
  return {
    callId: req.callId,
    risk: d.risk,
    level: d.level,
    tactics: d.tactics,
    reason: verdict.reason,
    action: d.action,
    updatedAt: Date.now(),
    calmStreak: d.calmStreak,
    claimedRelative: verdict.claimedRelative,
    verificationQuestion: d.action === 'ask_verification' ? VERIFICATION_QUESTION : undefined,
    familyAlerted: d.shouldAlert,
  };
}
