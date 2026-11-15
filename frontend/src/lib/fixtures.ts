// Static sample data so every screen renders on its own in the schematic,
// matching the moments the Figma frames show.
import type { RiskState, Utterance } from '../../../contracts/index.js';
import type { CallSnapshot } from './snapshot';

/** The phone number isn't available to the app (audio comes over speakerphone); demo value. */
export const SAMPLE_CALLER = { number: '+1 (602) 555-0147', label: 'Unknown caller' };

export const SAMPLE_QUESTION = "What was the name of Grandpa's old dog?";

const base: RiskState = {
  callId: 'c-4821',
  risk: 0,
  level: 'green',
  tactics: [],
  reason: '',
  action: 'none',
  updatedAt: 0,
  calmStreak: 0,
  claimedRelative: false,
  elderState: 'none',
  familyAlerted: false,
};

export const RISK: Record<'green' | 'yellow' | 'verifying' | 'red', RiskState> = {
  green: { ...base, risk: 8, reason: 'Sounds like a normal call.' },
  yellow: { ...base, risk: 45, level: 'yellow', tactics: ['urgency'], reason: 'The caller is rushing you.' },
  verifying: {
    ...base,
    risk: 55,
    level: 'yellow',
    tactics: ['impersonation', 'urgency', 'secrecy'],
    reason: 'Claims to be a grandson, says it is urgent and to keep it secret.',
    action: 'ask_verification',
    claimedRelative: true,
    verificationQuestion: SAMPLE_QUESTION,
  },
  red: {
    ...base,
    risk: 92,
    level: 'red',
    tactics: ['impersonation', 'urgency', 'secrecy', 'gift_cards'],
    reason: 'The caller pretended to be your grandson and asked for gift cards.',
    action: 'alert_family',
    claimedRelative: true,
    familyAlerted: true,
  },
};

const T0 = 1_700_000_000_000;
const lines: [number, string][] = [
  [8, "Hi Grandma, it's me, your grandson."],
  [20, "Grandma, I'm in trouble. I got in a car accident and they took me to jail."],
  [42, "I need you to keep this between us. Please don't tell Mom and Dad."],
  [70, 'I need two thousand dollars for bail right now.'],
  [118, 'Go to the store and buy two $500 gift cards. Read me the numbers.'],
];
export const SAMPLE_TRANSCRIPT: Utterance[] = lines.map(([sec, text], seq) => ({
  callId: 'c-4821',
  elderId: 'e-01',
  speaker: 'caller',
  text,
  ts: T0 + sec * 1000,
  seq,
}));

const callBase: CallSnapshot = {
  callId: 'c-4821',
  running: true,
  startedAt: T0,
  risk: RISK.verifying,
  view: 'verifying',
  verification: 'unasked',
  question: SAMPLE_QUESTION,
  transcript: SAMPLE_TRANSCRIPT.slice(0, 3),
  history: [
    { seq: 0, risk: 30, level: 'yellow', newTactics: ['impersonation'] },
    { seq: 1, risk: 45, level: 'yellow', newTactics: ['urgency'] },
    { seq: 2, risk: 55, level: 'yellow', newTactics: ['secrecy'] },
  ],
  latencyMs: 640,
  p95Ms: 910,
  agentStatus: 'idle',
  events: [],
};

/** D1: mid-call, engine leaning scam, family question asked. */
export const SNAPSHOT_LIVE: CallSnapshot = callBase;

/** D2: the caller fails the family question -> red. */
export const SNAPSHOT_VERIFY: CallSnapshot = {
  ...callBase,
  risk: { ...RISK.red, tactics: ['impersonation', 'urgency', 'secrecy'], risk: 85 },
  view: 'red',
  verification: 'failed',
  history: [...callBase.history, { seq: 2, risk: 85, level: 'red', newTactics: [], note: 'wrong answer to family question' }],
  events: [
    { callId: 'c-4821', type: 'off_speaker_requested', source: 'transcript', level: 'yellow', at: T0 + 46_000, detail: '“Can you take me off speaker?”' },
  ],
};

/** D3: Bedrock's verdict and reason for the current window. */
export const SNAPSHOT_ADJUDICATE: CallSnapshot = {
  ...callBase,
  view: 'yellow',
  risk: { ...RISK.verifying, action: 'none', reason: 'Likely scam: impersonation + secrecy. Caller claims to be a grandson in jail and asks to keep it from his parents.' },
  question: null,
};

/** F2 / E6: the finished call. */
export const SNAPSHOT_DONE: CallSnapshot = {
  ...callBase,
  running: false,
  risk: RISK.red,
  view: 'red',
  verification: 'failed',
  transcript: SAMPLE_TRANSCRIPT,
  history: [
    ...callBase.history,
    { seq: 3, risk: 70, level: 'yellow', newTactics: ['payment_request'] },
    { seq: 4, risk: 92, level: 'red', newTactics: ['gift_cards'] },
  ],
  events: [
    { callId: 'c-4821', type: 'off_speaker_requested', source: 'transcript', level: 'yellow', at: T0 + 46_000, detail: '“Can you take me off speaker?”' },
    { callId: 'c-4821', type: 'hangup', source: 'elder', level: 'red', at: T0 + 140_000, detail: 'Elder ended the call', notified: true },
  ],
};
