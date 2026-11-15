// Pure agent rules. No AWS calls here so they can be unit tested.
import type { AgentResponse, Utterance } from '../../../contracts/index.js';
import { extractJson } from '../analyze/rules.js';

/** After this many agent lines without a decision, the caller is treated as unverified. */
export const MAX_AGENT_TURNS = 6;
const MAX_SAY = 300;

export const SAFE_LINE = "Sorry, I can't help with that over the phone. Can you answer my question first?";
export const GOODBYE_LINE = "We're going to call the family directly on a number we already have. Goodbye.";
export const HANDBACK_LINE = 'Okay, thanks. Sorry about that, we just have to be careful. Here she is.';
export const TIMEOUT_LINE = "I'm going to let you go. We'll call back on a number we already have. Goodbye.";

type Outcome = Pick<AgentResponse, 'say' | 'status' | 'summary'>;
const STATUSES: AgentResponse['status'][] = ['active', 'verified', 'scam_confirmed', 'caller_left'];

export function agentTurns(utterances: Utterance[]): number {
  return utterances.filter((u) => u.speaker === 'agent').length;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** True if a non-agent line after the agent's first line contains the answer as whole words. */
export function callerGaveAnswer(utterances: Utterance[], answer: string): boolean {
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  const firstAgent = sorted.findIndex((u) => u.speaker === 'agent');
  if (firstAgent < 0) return false;
  const want = ` ${normalize(answer)} `;
  return sorted.slice(firstAgent + 1).some((u) => u.speaker !== 'agent' && ` ${normalize(u.text)} `.includes(want));
}

/** Parse the model reply and apply our guards. */
export function parseAgentReply(text: string, utterances: Utterance[], verificationAnswer: string): Outcome {
  const raw = extractJson(text);
  let say = typeof raw.say === 'string' ? raw.say.trim().slice(0, MAX_SAY) : '';
  let status: AgentResponse['status'] = (STATUSES as string[]).includes(raw.status as string)
    ? (raw.status as AgentResponse['status'])
    : 'active';
  let summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '';

  // The caller gave the right answer to the family question: verified, whatever the model thinks.
  if (verificationAnswer && callerGaveAnswer(utterances, verificationAnswer)) {
    status = 'verified';
    say = HANDBACK_LINE;
    summary = summary || 'The caller answered the family question correctly.';
  }

  // Never let the agent say the verification answer, whatever the caller tricked it into.
  if (verificationAnswer && say.toLowerCase().includes(verificationAnswer.toLowerCase())) say = SAFE_LINE;

  // This turn would be one more agent line; stop if that passes the cap.
  if (status === 'active' && agentTurns(utterances) + 1 > MAX_AGENT_TURNS) {
    say = TIMEOUT_LINE;
    status = 'scam_confirmed';
    summary = summary || `Caller could not be verified after ${MAX_AGENT_TURNS} questions.`;
  }
  if (status === 'active' && !say) say = SAFE_LINE;
  // A final decision must close the conversation, not ask another question.
  if (status === 'scam_confirmed' && (!say || say.includes('?'))) say = GOODBYE_LINE;
  if (status === 'verified' && (!say || say.includes('?'))) say = HANDBACK_LINE;
  return { say, status, summary };
}
