import { describe, expect, it } from 'vitest';
import {
  asksVerification,
  callerGaveAnswer,
  GATHER_LINES,
  GOODBYE_LINE,
  HANDBACK_LINE,
  MAX_AGENT_TURNS,
  parseAgentReply,
  SAFE_LINE,
  STEP_BACK_LINE,
  TIMEOUT_LINE,
} from '../lambda/agent/rules.js';

const u = (speaker: string, seq: number) => ({ callId: 'c', elderId: 'e', speaker, text: 'x', ts: seq, seq });
const reply = (o: object) => JSON.stringify(o);

describe('parseAgentReply', () => {
  it('passes a normal turn through', () => {
    const r = parseAgentReply(reply({ say: 'Who is this?', status: 'active', summary: 's' }), [u('caller', 0)], 'Biscuit');
    expect(r).toEqual({ say: 'Who is this?', status: 'active', summary: 's' });
  });

  it('on a phone call, the elder saying the answer does not verify the caller', () => {
    const said = (speaker: string, seq: number, text: string) => ({ ...u(speaker, seq), text });
    const call = [u('agent', 0), said('elder', 1, 'It was Biscuit!')];
    expect(callerGaveAnswer(call, 'Biscuit')).toBe(false);
    expect(callerGaveAnswer([...call, said('caller', 2, 'biscuit, yeah')], 'Biscuit')).toBe(true);
  });

  it('only the elder can send the agent away', () => {
    const stop = reply({ say: 'Shall I go?', status: 'stopped', summary: 's' });
    expect(parseAgentReply(stop, [u('agent', 0), u('caller', 1)], 'Biscuit').status).toBe('active');
    expect(parseAgentReply(stop, [u('elder', 0), u('agent', 1), u('caller', 2)], 'Biscuit').status).toBe('active');
    const r = parseAgentReply(stop, [u('agent', 0), u('elder', 1)], 'Biscuit');
    expect(r.status).toBe('stopped');
    expect(r.say).toBe(STEP_BACK_LINE); // a closing line can't be a question
  });

  it('never says the verification answer', () => {
    const r = parseAgentReply(reply({ say: 'Was it biscuit?', status: 'active' }), [], 'Biscuit');
    expect(r.say).toBe(SAFE_LINE);
  });

  it('treats an unknown status as active and fills an empty line', () => {
    const r = parseAgentReply(reply({ say: '', status: 'thinking' }), [], 'Biscuit');
    expect(r.status).toBe('active');
    expect(r.say).toBe(SAFE_LINE);
  });

  it('ends the conversation as unverified after the turn cap', () => {
    const history = Array.from({ length: MAX_AGENT_TURNS }, (_, i) => u('agent', i));
    const r = parseAgentReply(reply({ say: 'One more question', status: 'active' }), history, 'Biscuit');
    expect(r.status).toBe('scam_confirmed');
    expect(r.say).toBe(TIMEOUT_LINE);
  });

  it('a scam verdict never hangs up: it ends on the step-back warning, not a goodbye or another request', () => {
    for (const say of ['Okay. Goodbye.', 'I need to know which jail you are at so we can verify this.', '']) {
      const r = parseAgentReply(reply({ say, status: 'scam_confirmed' }), [], 'Biscuit');
      expect(r.say).toBe(GOODBYE_LINE);
      expect(r.say).toMatch(/step back/i);
      expect(r.say).not.toMatch(/goodbye|hang up/i);
    }
    const own = "Okay, nobody here is sending anything. I'll step back now.";
    expect(parseAgentReply(reply({ say: own, status: 'scam_confirmed' }), [], 'Biscuit').say).toBe(own);
  });

  it('closes with a goodbye instead of a question once the scam is confirmed', () => {
    const r = parseAgentReply(reply({ say: 'Can you tell me the name?', status: 'scam_confirmed' }), [], 'Biscuit');
    expect(r.say).toBe(GOODBYE_LINE);
  });

  it('verifies when the caller says the answer after the agent took over', () => {
    const history = [u('agent', 0), { ...u('caller', 1), text: 'Biscuit! The golden retriever.' }];
    const r = parseAgentReply(reply({ say: 'One more question?', status: 'active' }), history, 'Biscuit');
    expect(r.status).toBe('verified');
    expect(r.say).toBe(HANDBACK_LINE);
  });

  it('ignores the answer if it was said before the takeover, or inside another word', () => {
    expect(callerGaveAnswer([{ ...u('caller', 0), text: 'biscuit' }, u('agent', 1)], 'Biscuit')).toBe(false);
    expect(callerGaveAnswer([u('agent', 0), { ...u('caller', 1), text: 'biscuits for breakfast' }], 'Biscuit')).toBe(false);
  });

  const Q = 'What did we name the family dog when you were little?';

  it('recognizes the verification question, even reworded, and nothing else', () => {
    expect(asksVerification('Quick one: what did we name the family dog when you were little?', Q)).toBe(true);
    expect(asksVerification('What was the name of the family dog?', Q)).toBe(true);
    expect(asksVerification("What's a good number to call you back on?", Q)).toBe(false);
    expect(asksVerification('We named the dog after grandpa.', Q)).toBe(false); // not a question
  });

  it('asks the security question only once, then gathers details instead', () => {
    const history = [
      { ...u('agent', 0), text: `Hi, this is Mike. ${Q}` },
      { ...u('caller', 1), text: "I don't remember." },
    ];
    const r = parseAgentReply(reply({ say: `Come on, ${Q}`, status: 'active' }), history, 'Biscuit', Q);
    expect(asksVerification(r.say, Q)).toBe(false);
    expect(GATHER_LINES).toContain(r.say);
    expect(r.status).toBe('active');
  });

  it('does not repeat an organization check either, even reworded without a question mark', () => {
    const history = [
      { ...u('agent', 0), text: "Hi, this is Mike, her son. Can you tell me your employee number and which department you're calling from?" },
      { ...u('caller', 1), text: 'This is urgent, she must install the program now.' },
    ];
    const r = parseAgentReply(reply({ say: 'I need that employee number and department name before we go any further.', status: 'active' }), history, 'Biscuit', Q);
    expect(GATHER_LINES).toContain(r.say);
  });

  it('lets a different follow-up through', () => {
    const history = [{ ...u('agent', 0), text: `Hi, this is Mike. ${Q}` }, { ...u('caller', 1), text: 'Uh, I forget.' }];
    const r = parseAgentReply(reply({ say: 'Okay. Which jail are you at right now?', status: 'active' }), history, 'Biscuit', Q);
    expect(r.say).toBe('Okay. Which jail are you at right now?');
  });

  it('lets the first security question through', () => {
    const r = parseAgentReply(reply({ say: `Hi, this is Mike. ${Q}`, status: 'active' }), [u('caller', 0)], 'Biscuit', Q);
    expect(r.say).toContain('family dog');
  });

  it('keeps the gathered details in the summary for the family', () => {
    const long = 'Caller claimed to be Tommy, at the county jail downtown; lawyer Mr. Davis 602-555-0199; wanted two $500 Target gift cards read over the phone. '.repeat(3);
    const r = parseAgentReply(reply({ say: 'Goodbye.', status: 'scam_confirmed', summary: long }), [], 'Biscuit', Q);
    expect(r.summary.length).toBeGreaterThan(300);
  });

  it('keeps a final decision on the last allowed turn', () => {
    const history = Array.from({ length: MAX_AGENT_TURNS }, (_, i) => u('agent', i));
    const r = parseAgentReply(reply({ say: 'Here she is.', status: 'verified' }), history, 'Biscuit');
    expect(r.status).toBe('verified');
  });
});
