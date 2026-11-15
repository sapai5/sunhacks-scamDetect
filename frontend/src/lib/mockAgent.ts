// Offline stand-in for the Agent Lambda so the takeover works with no AWS.
// Scripted lines replace Bedrock; the real answer check (backend agent/rules.ts) decides "verified".
import type { AgentRequest, AgentResponse } from '../../../contracts/index.js';
import { callerGaveAnswer, GOODBYE_LINE, HANDBACK_LINE } from '../../../backend/lambda/agent/rules.js';

/** Matches the demo answer in backend/cdk.json. */
const MOCK_ANSWER = 'Biscuit';
const QUESTION = 'What did we name the family dog when you were little?';

export async function mockAgent(req: AgentRequest): Promise<AgentResponse> {
  await new Promise((r) => setTimeout(r, 400)); // feel like a network call
  const turns = req.utterances.filter((u) => u.speaker === 'agent').length;
  const base = { callId: req.callId, familyNotified: false };

  if (callerGaveAnswer(req.utterances, MOCK_ANSWER)) {
    return { ...base, say: HANDBACK_LINE, status: 'verified', summary: 'Mock: the caller answered the family question.' };
  }
  if (turns === 0) {
    return { ...base, say: `Hi, this is Mike, her son. She handed me the phone. ${QUESTION}`, status: 'active', summary: '' };
  }
  if (turns === 1) {
    return { ...base, say: `I need you to answer the question first. ${QUESTION}`, status: 'active', summary: '' };
  }
  return { ...base, say: GOODBYE_LINE, status: 'scam_confirmed', summary: 'Mock: the caller dodged the family question twice.' };
}
