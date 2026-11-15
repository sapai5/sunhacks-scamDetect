import { describe, expect, it } from 'vitest';
import {
  callerGaveAnswer,
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

  it('keeps a final decision on the last allowed turn', () => {
    const history = Array.from({ length: MAX_AGENT_TURNS }, (_, i) => u('agent', i));
    const r = parseAgentReply(reply({ say: 'Here she is.', status: 'verified' }), history, 'Biscuit');
    expect(r.status).toBe('verified');
  });
});
