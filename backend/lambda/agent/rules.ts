// Pure agent rules. No AWS calls here so they can be unit tested.
import type { AgentResponse, Utterance } from '../../../contracts/index.js';
import { extractJson } from '../analyze/rules.js';

/**
 * After this many agent lines without a decision, the caller is treated as unverified.
 * One security question, then several turns of gathering details for the family and a scam report.
 */
export const MAX_AGENT_TURNS = 8;
const MAX_SAY = 300;
/** Room for the details gathered (names, numbers, places, payment method) in the family email. */
const MAX_SUMMARY = 700;

/** Used instead of a repeated security question: move on to gathering details. */
export const GATHER_LINES = [
  "Okay. What's a good number to call you back on?",
  'Got it. And what was your full name again?',
  'Where are you calling from right now?',
  'Hang on, let me grab a pen. How exactly were you wanting the money sent?',
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'did', 'we', 'you', 'your', 'our', 'what', 'when', 'were', 'was', 'is', 'to', 'of', 'and', 'in', 'on',
  'for', 'do', 'it', 'that', 'can', 'tell', 'me', 'little', 'which', 'from', 'calling', 'call', 'need', 'give', 'please',
  'before', 'any', 'further', 'first', 'this', 'with', 'are', 'there', 'just', 'okay', 'right', 'now', 'here', 'she', 'her',
]);
const contentWords = (s: string) => normalizeText(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w));
function normalizeText(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Share of `question`'s content words that also appear in `line`. */
function overlap(line: string, question: string): number {
  const q = contentWords(question);
  if (q.length < 2) return 0;
  const words = new Set(contentWords(line));
  return q.filter((w) => words.has(w)).length / q.length;
}

/** True if `line` asks the verification question: it shares most of the question's content words. */
export function asksVerification(line: string, question: string): boolean {
  return line.includes('?') && overlap(line, question) >= 0.6;
}

/** The security question in the agent's first line: its last sentence ending in "?". */
export function firstQuestion(line: string): string {
  const questions = line.match(/[^.!?]*\?/g);
  return questions?.at(-1)?.trim() ?? '';
}

/**
 * True if `line` asks the security check again: the family question, or (for callers who claim to be
 * a bank, police, a company) whatever Mike asked first, even reworded as "I need that … first."
 */
export function repeatsSecurityCheck(line: string, agentLines: string[], verificationQuestion: string): boolean {
  if (verificationQuestion && asksVerification(line, verificationQuestion)
      && agentLines.some((l) => asksVerification(l, verificationQuestion))) return true;
  const first = agentLines.length ? firstQuestion(agentLines[0]) : '';
  return Boolean(first) && overlap(line, first) >= 0.6;
}

export const SAFE_LINE = "Sorry, I can't help with that over the phone. Can you answer my question first?";
export const GOODBYE_LINE = "We'll check this with the family directly, so nobody here is sending money or any numbers. I'll step back now.";
export const HANDBACK_LINE = 'Okay, thanks. Sorry about that, we just have to be careful. Here she is.';
export const STEP_BACK_LINE = "Okay, I'll step back. I'm here if you need me.";
export const TIMEOUT_LINE = "I couldn't confirm who you are, so nobody here is sending anything. We'll call the family on a number we already have. I'll step back now.";

type Outcome = Pick<AgentResponse, 'say' | 'status' | 'summary'>;
const STATUSES: AgentResponse['status'][] = ['active', 'verified', 'scam_confirmed', 'caller_left', 'stopped'];

export function agentTurns(utterances: Utterance[]): number {
  return utterances.filter((u) => u.speaker === 'agent').length;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * True if a line after the agent's first line contains the answer as whole words. Lines labelled
 * 'elder' (phone calls, where the elder stays on the line) don't count: the caller must say it.
 */
export function callerGaveAnswer(utterances: Utterance[], answer: string): boolean {
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  const firstAgent = sorted.findIndex((u) => u.speaker === 'agent');
  if (firstAgent < 0) return false;
  const want = ` ${normalize(answer)} `;
  return sorted.slice(firstAgent + 1).some((u) => u.speaker !== 'agent' && u.speaker !== 'elder' && ` ${normalize(u.text)} `.includes(want));
}

/** Parse the model reply and apply our guards. */
export function parseAgentReply(text: string, utterances: Utterance[], verificationAnswer: string, verificationQuestion = ''): Outcome {
  const raw = extractJson(text);
  let say = typeof raw.say === 'string' ? raw.say.trim().slice(0, MAX_SAY) : '';
  let status: AgentResponse['status'] = (STATUSES as string[]).includes(raw.status as string)
    ? (raw.status as AgentResponse['status'])
    : 'active';
  let summary = typeof raw.summary === 'string' ? raw.summary.slice(0, MAX_SUMMARY) : '';

  // The security check is asked once. If the model tries again, gather details instead.
  const agentLines = [...utterances].sort((a, b) => a.seq - b.seq).filter((u) => u.speaker === 'agent').map((u) => u.text);
  if (status === 'active' && repeatsSecurityCheck(say, agentLines, verificationQuestion)) {
    const used = new Set(agentLines);
    say = GATHER_LINES.find((l) => !used.has(l)) ?? GATHER_LINES[0];
  }

  // The caller gave the right answer to the family question: verified, whatever the model thinks.
  if (verificationAnswer && callerGaveAnswer(utterances, verificationAnswer)) {
    status = 'verified';
    say = HANDBACK_LINE;
    summary = summary || 'The caller answered the family question correctly.';
  }

  // Only the elder can send the agent away, and only where their lines are labelled reliably (phone calls).
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  const joined = sorted.findIndex((u) => u.speaker === 'agent');
  if (status === 'stopped' && !(joined >= 0 && sorted.slice(joined + 1).some((u) => u.speaker === 'elder'))) status = 'active';

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
  // A scam verdict always ends on the standard warning unless the model's own line already steps back:
  // the elder stays on the call, so the last thing she hears must be "nobody here is sending anything".
  if (status === 'scam_confirmed' && (!say || say.includes('?') || !/step(ping)? back/i.test(say))) say = GOODBYE_LINE;
  if (status === 'verified' && (!say || say.includes('?'))) say = HANDBACK_LINE;
  if (status === 'stopped' && (!say || say.includes('?'))) say = STEP_BACK_LINE;
  return { say, status, summary };
}
