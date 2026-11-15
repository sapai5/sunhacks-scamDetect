import { describe, expect, it } from 'vitest';
import type { RiskState } from '../../../contracts/index.js';
import { PHONE_CALL_QUIET_MS, pushedStateEffect } from './callState';

const state = (callId: string, updatedAt: number): RiskState => ({
  callId,
  risk: 40,
  level: 'yellow',
  tactics: [],
  reason: '',
  action: 'none',
  updatedAt,
  calmStreak: 0,
  claimedRelative: false,
  elderState: 'none',
  familyAlerted: false,
});
const idle = { callId: '', running: false, phone: false, risk: null };

describe('pushedStateEffect', () => {
  it('starts showing a phone call when nothing is running', () => {
    expect(pushedStateEffect(idle, state('p1', 1))).toBe('new');
  });

  it('keeps the phone call on screen while it is active; another call takes over once it goes quiet', () => {
    const showing = { callId: 'p1', running: true, phone: true, risk: state('p1', 1_000) };
    expect(pushedStateEffect(showing, state('p2', 1_000 + 5_000))).toBe('ignore');
    expect(pushedStateEffect(showing, state('p2', 1_000 + PHONE_CALL_QUIET_MS + 1))).toBe('new');
  });

  it('never interrupts a speakerphone or demo call', () => {
    expect(pushedStateEffect({ callId: 'c-1', running: true, phone: false, risk: null }, state('p1', 1))).toBe('ignore');
  });

  it('updates the call on screen, but not with stale results or after the elder ended it', () => {
    const showing = { callId: 'p1', running: true, phone: true, risk: state('p1', 5) };
    expect(pushedStateEffect(showing, state('p1', 6))).toBe('update');
    expect(pushedStateEffect(showing, state('p1', 5))).toBe('update'); // same RiskState, new agent progress
    expect(pushedStateEffect(showing, state('p1', 4))).toBe('ignore');
    expect(pushedStateEffect({ ...showing, running: false }, state('p1', 6))).toBe('ignore');
  });
});
