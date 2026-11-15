// Shared contracts between the web app and the Lambdas.
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

export type Action = 'none' | 'ask_verification' | 'alert_family' | 'agent_takeover';

/** Whether the elder has asked the verification question, and the result. */
export const VERIFICATIONS = ['unasked', 'passed', 'failed'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/**
 * How the elder is responding to the caller, judged by the model.
 * - none: not engaging, or resisting ("I'll call your mother first")
 * - engaging: starting to fall for it: sympathetic, answering their questions, asking how to help
 * - complying: clearly falling for it: agrees to pay, going to buy cards, reading numbers, sharing codes
 */
export const ELDER_STATES = ['none', 'engaging', 'complying'] as const;
export type ElderState = (typeof ELDER_STATES)[number];

/** Where the takeover agent is in its job. */
export const AGENT_STATUSES = ['idle', 'active', 'verified', 'scam_confirmed', 'caller_left', 'stopped'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * One finished sentence. `speaker` is a diarization label from Transcribe
 * (spk_0, spk_1, ...), "agent" for lines our agent spoke, or "caller"/"elder"
 * in test scripts.
 */
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
  familyAlerted: boolean;
  agentStatus: AgentStatus;
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
  elderState: ElderState;
  verificationQuestion?: string;
  /** True if this response sent the family alert. */
  familyAlerted: boolean;
}

/**
 * Stage 2: Connect transcriber -> IngestFn, one per finished sentence.
 * callId is the Amazon Connect ContactId. speaker comes from the KVS audio track,
 * so it's exact: "caller" = from customer (the person who dialed in),
 * "elder" = to customer (what the caller hears, i.e. the elder's phone).
 * Direct Lambda invoke. IngestFn orders sentences by arrival (seq is ignored, ts defaults to now)
 * and returns the call's new RiskState, or null while the agent has the call.
 */
export interface IngestRequest extends Utterance {
  speaker: 'caller' | 'elder';
}

/** App -> Agent Lambda: the transcript so far, including the agent's own lines. */
export interface AgentRequest {
  callId: string;
  elderId: string;
  utterances: Utterance[];
}

/** Agent Lambda -> app: the next thing to say, and whether the agent is done. */
export interface AgentResponse {
  callId: string;
  /** Line for the browser to speak. Empty when there's nothing more to say. */
  say: string;
  /** 'active' means keep the conversation going. */
  status: Exclude<AgentStatus, 'idle' | 'stopped'>;
  summary: string;
  /** True if this response emailed the family a summary. */
  familyNotified: boolean;
}

// ---------------------------------------------------------------------------
// Call events: hang-up and speakerphone detection (Events Lambda contracts).
// The app runs on a device NEXT TO the speakerphone, so it can't read the phone's call
// state. Events are inferred from the mic (tones, silence), from what the caller says,
// or reported by the elder with a tap.
// ---------------------------------------------------------------------------

export const CALL_EVENT_TYPES = [
  /** The call ended (elder tapped Hang up / confirmed, or a dial/busy tone was heard). */
  'hangup',
  /** The caller can no longer be heard: probably taken off speaker (or on hold). */
  'speaker_off',
  /** Caller audio is back after a speaker_off. */
  'speaker_on',
  /** The caller asked to be taken off speaker / asked if anyone else is listening (isolation tactic). */
  'off_speaker_requested',
] as const;
export type CallEventType = (typeof CALL_EVENT_TYPES)[number];

/** Who noticed: the elder (tap), the mic analyser, or the transcript. */
export type CallEventSource = 'elder' | 'audio' | 'transcript';

export interface CallEvent {
  callId: string;
  type: CallEventType;
  source: CallEventSource;
  /** Risk level when it happened: decides whether the family is texted. */
  level: Level;
  at: number;
  /** Short human detail, e.g. "dial tone heard", "No audio for 12 s". */
  detail?: string;
}

/** POST body for the Events Lambda. */
export type CallEventRequest = CallEvent;

export interface CallEventResponse {
  /** True when the family was texted about this event. */
  notified: boolean;
}

// ---------------------------------------------------------------------------
// Stage 2 (Track B): elder settings and push. IngestRequest is above, next to RiskState.
// ---------------------------------------------------------------------------

export interface Contact {
  name: string;
  phone: string;
}

/**
 * One elder's settings (Elders table). Settings API: GET ?elderId= returns them without
 * verificationAnswer; PUT {elderId, ...fields} updates the fields given.
 * WebSocket push: connect with ?elderId=; each message is a PushMessage (JSON) for one of the elder's calls.
 */
export interface ElderSettings {
  elderId: string;
  elderName: string;
  verificationQuestion: string;
  verificationAnswer: string;
  agentName: string;
  agentRelation: string;
  /** Family contacts from onboarding. Alerts still go to the SNS topic's subscribers. */
  family: Contact[];
  /** E.164 numbers whose calls skip screening (Connect contacts check). */
  trustedContacts: string[];
}

/** Push socket -> app: a phone call's latest RiskState plus the phone agent's progress. */
export interface PushMessage extends RiskState {
  agentStatus: AgentStatus;
  agentSummary?: string;
  /** The phone agent's latest line. */
  agentSay?: string;
}

/** App -> push socket: the elder tapped "Let me talk" while the phone agent had the call. */
export interface PushStopAgent {
  action: 'stopAgent';
  callId: string;
}
