import { describe, expect, it } from 'vitest';
import { BadRequest, decide, parseRequest, parseVerdict, recentWindow, type ModelVerdict } from '../lambda/analyze/rules.js';

const v = (p: Partial<ModelVerdict>): ModelVerdict => ({ risk: 0, tactics: [], reason: '', claimedRelative: false, ...p });
const fresh = { prevLevel: 'green' as const, calmStreak: 0, verification: 'unasked' as const };

describe('decide', () => {
  it('keeps calm calls green', () => {
    expect(decide(v({ risk: 10 }), fresh).level).toBe('green');
  });

  it('one tactic is yellow, not red', () => {
    expect(decide(v({ risk: 80, tactics: ['urgency'] }), fresh).level).toBe('yellow');
  });

  it('red needs 2+ tactics and alerts once on the transition', () => {
    const d = decide(v({ risk: 85, tactics: ['impersonation', 'payment_request'] }), fresh);
    expect(d.level).toBe('red');
    expect(d.action).toBe('alert_family');
    expect(d.shouldAlert).toBe(true);
    const again = decide(v({ risk: 90, tactics: ['impersonation', 'payment_request'] }), { ...fresh, prevLevel: 'red' });
    expect(again.shouldAlert).toBe(false);
  });

  it('asks verification on yellow with a claimed relative, only once', () => {
    const d = decide(v({ risk: 50, tactics: ['impersonation'], claimedRelative: true }), fresh);
    expect(d.action).toBe('ask_verification');
    const asked = decide(v({ risk: 50, tactics: ['impersonation'], claimedRelative: true }), { ...fresh, prevLevel: 'yellow', verification: 'passed' });
    expect(asked.action).toBe('none');
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
    expect(one.calmStreak).toBe(1);
    const two = decide(v({ risk: 5 }), { ...fresh, prevLevel: 'yellow', calmStreak: one.calmStreak });
    expect(two.level).toBe('green');
  });

  it('a risky result resets the calm streak', () => {
    expect(decide(v({ risk: 50, tactics: ['secrecy'] }), { ...fresh, prevLevel: 'yellow', calmStreak: 1 }).calmStreak).toBe(0);
  });
});

describe('parseVerdict', () => {
  it('extracts JSON from surrounding text and drops unknown tactics', () => {
    const p = parseVerdict('Here: {"risk": 130, "tactics": ["urgency","made_up","urgency"], "reason": "x", "claimedRelative": true}');
    expect(p).toEqual({ risk: 100, tactics: ['urgency'], reason: 'x', claimedRelative: true });
  });
  it('throws without JSON', () => {
    expect(() => parseVerdict('no json')).toThrow();
  });
});

describe('recentWindow', () => {
  it('keeps the last 60 s measured from the newest sentence', () => {
    const u = (seq: number, ts: number) => ({ callId: 'c', elderId: 'e', speaker: 'caller', text: String(seq), ts, seq });
    const w = recentWindow([u(0, 0), u(1, 50_000), u(2, 100_000)]);
    expect(w.map((x) => x.seq)).toEqual([1, 2]);
  });
});

describe('parseRequest', () => {
  it('rejects missing callId', () => {
    expect(() => parseRequest({ elderId: 'e', utterances: [] })).toThrow(BadRequest);
  });
  it('defaults bad enum values', () => {
    const r = parseRequest({ callId: 'c', elderId: 'e', utterances: [{ text: 'hi' }], prevLevel: 'purple', verification: 'x' });
    expect(r.prevLevel).toBe('green');
    expect(r.verification).toBe('unasked');
    expect(r.utterances[0].seq).toBe(0);
  });
});
