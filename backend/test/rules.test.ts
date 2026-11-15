import { describe, expect, it } from 'vitest';
import { BadRequest, decide, parseRequest, parseVerdict, recentWindow, type ModelVerdict } from '../lambda/analyze/rules.js';

const v = (p: Partial<ModelVerdict>): ModelVerdict => ({
  risk: 0,
  tactics: [],
  reason: '',
  claimedRelative: false,
  elderState: 'none',
  ...p,
});
const fresh = {
  prevLevel: 'green' as const,
  calmStreak: 0,
  verification: 'unasked' as const,
  familyAlerted: false,
  agentStatus: 'idle' as const,
};
const scam = { risk: 90, tactics: ['impersonation', 'payment_request'] as ModelVerdict['tactics'] };

describe('decide: levels', () => {
  it('keeps calm calls green', () => {
    expect(decide(v({ risk: 10 }), fresh).level).toBe('green');
  });

  it('one tactic is yellow, not red', () => {
    expect(decide(v({ risk: 80, tactics: ['urgency'] }), fresh).level).toBe('yellow');
  });

  it('red needs 2+ tactics', () => {
    expect(decide(v(scam), fresh).level).toBe('red');
  });

  it('failed verification with a claimed relative goes red', () => {
    const d = decide(v({ risk: 50, tactics: ['urgency'], claimedRelative: true }), { ...fresh, prevLevel: 'yellow', verification: 'failed' });
    expect(d.level).toBe('red');
  });

  it('passed verification removes impersonation', () => {
    const d = decide(v({ risk: 70, tactics: ['impersonation', 'urgency'], claimedRelative: true }), { ...fresh, verification: 'passed' });
    expect(d.tactics).toEqual(['urgency']);
    expect(d.level).toBe('yellow');
  });

  it('drops back to green only after two calm results in a row', () => {
    const one = decide(v({ risk: 5 }), { ...fresh, prevLevel: 'yellow' });
    expect(one.level).toBe('yellow');
    const two = decide(v({ risk: 5 }), { ...fresh, prevLevel: 'yellow', calmStreak: one.calmStreak });
    expect(two.level).toBe('green');
  });

  it('a risky result resets the calm streak', () => {
    expect(decide(v({ risk: 50, tactics: ['secrecy'] }), { ...fresh, prevLevel: 'yellow', calmStreak: 1 }).calmStreak).toBe(0);
  });
});

describe('decide: family alert and agent takeover', () => {
  it('red alone does not alert the family while the elder is not going along', () => {
    const d = decide(v({ ...scam, elderState: 'none' }), fresh);
    expect(d.level).toBe('red');
    expect(d.shouldAlert).toBe(false);
    expect(d.action).toBe('agent_takeover'); // the agent joins; the family isn't alerted yet
  });

  it('alerts once when the elder starts engaging on a red call', () => {
    const d = decide(v({ ...scam, elderState: 'engaging' }), fresh);
    expect(d.shouldAlert).toBe(true);
    expect(d.action).toBe('agent_takeover'); // the agent joins in the same step
    expect(decide(v({ ...scam, elderState: 'engaging' }), { ...fresh, agentStatus: 'active' }).action).toBe('alert_family');
    expect(decide(v({ ...scam, elderState: 'engaging' }), { ...fresh, prevLevel: 'red', familyAlerted: true }).shouldAlert).toBe(false);
  });

  it('engaging on a yellow call does not alert', () => {
    expect(decide(v({ risk: 50, tactics: ['urgency'], elderState: 'engaging' }), fresh).shouldAlert).toBe(false);
  });

  it('the agent joins any red call, even when the elder is not going along (no family alert then)', () => {
    const d = decide(v({ ...scam, elderState: 'none' }), fresh);
    expect(d.action).toBe('agent_takeover');
    expect(d.shouldAlert).toBe(false);
    expect(decide(v({ risk: 50, tactics: ['urgency'], elderState: 'complying' }), fresh).action).not.toBe('agent_takeover');
  });

  it('takes over when the elder is complying on a red call, and alerts in the same step', () => {
    const d = decide(v({ ...scam, elderState: 'complying' }), fresh);
    expect(d.action).toBe('agent_takeover');
    expect(d.shouldAlert).toBe(true);
  });

  it('does not take over twice, or after the elder stopped the agent', () => {
    for (const agentStatus of ['active', 'scam_confirmed', 'stopped'] as const) {
      expect(decide(v({ ...scam, elderState: 'complying' }), { ...fresh, agentStatus }).action).not.toBe('agent_takeover');
    }
  });

  it('after the agent verified the caller, the call cannot go red again', () => {
    const d = decide(v({ ...scam, tactics: ['impersonation', 'payment_request', 'urgency'], elderState: 'complying' }), {
      ...fresh,
      prevLevel: 'red',
      familyAlerted: true,
      agentStatus: 'verified',
    });
    expect(d.level).toBe('yellow');
    expect(d.action).toBe('none');
  });

  it('does not ask the elder the verification question while the agent is involved', () => {
    const d = decide(v({ risk: 50, tactics: ['impersonation'], claimedRelative: true }), { ...fresh, agentStatus: 'verified' });
    expect(d.action).toBe('none');
  });
});

describe('parseVerdict', () => {
  it('extracts JSON from surrounding text and drops unknown values', () => {
    const p = parseVerdict(
      'Here: {"risk": 130, "tactics": ["urgency","made_up","urgency"], "reason": "x", "claimedRelative": true, "elderState": "sleepy"}',
    );
    expect(p).toEqual({ risk: 100, tactics: ['urgency'], reason: 'x', claimedRelative: true, elderState: 'none', exposures: [] });
  });
  it('throws without JSON', () => {
    expect(() => parseVerdict('no json')).toThrow();
  });
});

describe('recentWindow', () => {
  it('keeps the last 60 s measured from the newest sentence', () => {
    const u = (seq: number, ts: number) => ({ callId: 'c', elderId: 'e', speaker: 'caller', text: String(seq), ts, seq });
    expect(recentWindow([u(0, 0), u(1, 50_000), u(2, 100_000)]).map((x) => x.seq)).toEqual([1, 2]);
  });
});

describe('parseRequest', () => {
  it('rejects missing callId', () => {
    expect(() => parseRequest({ elderId: 'e', utterances: [] })).toThrow(BadRequest);
  });
  it('defaults bad enum values', () => {
    const r = parseRequest({ callId: 'c', elderId: 'e', utterances: [{ text: 'hi' }], prevLevel: 'purple', agentStatus: 'x' });
    expect(r.prevLevel).toBe('green');
    expect(r.verification).toBe('unasked');
    expect(r.agentStatus).toBe('idle');
    expect(r.familyAlerted).toBe(false);
  });
});
