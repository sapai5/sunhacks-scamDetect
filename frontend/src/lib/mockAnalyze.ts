// Offline stand-in for the Analyze Lambda so the UI works with no AWS.
// Keyword matching replaces Bedrock; the real level rules (backend rules.ts) decide the level.
import type { AnalyzeRequest, ElderState, RiskState, Tactic } from '../../../contracts/index.js';
import { decide, recentWindow, type ModelVerdict } from '../../../backend/lambda/analyze/rules.js';

const PATTERNS: [Tactic, RegExp][] = [
  ['impersonation', /\b(it'?s me|grandson|granddaughter|from the (irs|bank|police)|social security office|microsoft)\b/i],
  ['urgency', /\b(right now|today|immediately|trouble|jail|bail|accident|hurry)\b/i],
  ['secrecy', /\b(don'?t tell|keep this between|secret)\b/i],
  ['payment_request', /\b(dollars|pay|money|\$\d+)\b/i],
  ['gift_cards', /\bgift ?cards?\b/i],
  ['wire_or_crypto', /\b(wire|bitcoin|crypto|western union|zelle)\b/i],
  ['remote_access', /\b(remote|teamviewer|anydesk|your computer)\b/i],
  ['personal_info_request', /\b(social security number|password|account number|pin)\b/i],
  ['threats', /\b(arrest|warrant|lawsuit|deport|frozen)\b/i],
];
const RELATIVE = /\b(grandma|grandpa|grandson|granddaughter|it'?s me)\b/i;
const COMPLYING = /\b(i'?ll (go|send|get|pay)|send it|right now and get|typing in|here are the numbers)\b/i;
const ENGAGING = /\b(are you okay|what do you need|how do i|what should i do|of course|okay)\b/i;

export const VERIFICATION_QUESTION = 'What did we name the family dog when you were little?';

export async function mockAnalyze(req: AnalyzeRequest): Promise<RiskState> {
  await new Promise((r) => setTimeout(r, 300)); // feel like a network call
  const window = recentWindow(req.utterances).filter((u) => u.speaker !== 'agent');
  const callerText = window.filter((u) => u.speaker !== 'elder').map((u) => u.text).join(' ');
  const elderText = window.filter((u) => u.speaker === 'elder').map((u) => u.text).join(' ');
  const tactics = PATTERNS.filter(([, re]) => re.test(callerText)).map(([t]) => t);
  const elderState: ElderState = COMPLYING.test(elderText) ? 'complying' : ENGAGING.test(elderText) ? 'engaging' : 'none';
  const verdict: ModelVerdict = {
    risk: Math.min(100, tactics.length * 25),
    tactics,
    reason: tactics.length ? `Mock: heard ${tactics.join(', ').replaceAll('_', ' ')}.` : '',
    claimedRelative: RELATIVE.test(callerText),
    elderState,
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
    elderState,
    verificationQuestion: d.action === 'ask_verification' ? VERIFICATION_QUESTION : undefined,
    familyAlerted: d.shouldAlert,
  };
}
