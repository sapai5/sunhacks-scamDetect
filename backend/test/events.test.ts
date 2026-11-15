import { describe, expect, it } from 'vitest';
import type { CallEventRequest } from '../../contracts/index.js';
import { BadRequest, familyMessage, parseEventRequest } from '../lambda/events/logic.js';

const ev = (p: Partial<CallEventRequest>): CallEventRequest => ({ callId: 'c', type: 'hangup', source: 'elder', level: 'red', at: 0, ...p });

describe('parseEventRequest', () => {
  it('rejects bad bodies and unknown types', () => {
    expect(() => parseEventRequest(null)).toThrow(BadRequest);
    expect(() => parseEventRequest({ callId: 'c', type: 'explode' })).toThrow(BadRequest);
  });

  it('defaults source and level, and drops unknown fields', () => {
    const r = parseEventRequest({ callId: 'c', type: 'speaker_off', source: 'satellite', level: 'purple', hacker: 'x' });
    expect(r).toMatchObject({ source: 'elder', level: 'green' });
    expect(r).not.toHaveProperty('hacker');
  });
});

describe('familyMessage', () => {
  it('texts urgently when a risky call goes off speaker', () => {
    expect(familyMessage(ev({ type: 'speaker_off', level: 'red' }), 'Rose')).toMatch(/Rose may have taken a likely scam call off speaker.*call Rose now/);
    expect(familyMessage(ev({ type: 'speaker_off', level: 'yellow' }), 'Rose')).toMatch(/suspicious call/);
  });

  it('sends a hang-up follow-up on red calls', () => {
    expect(familyMessage(ev({}), 'Rose')).toMatch(/Rose hung up on the likely scam call/);
  });

  it('stays quiet for green calls and non-actionable events', () => {
    expect(familyMessage(ev({ level: 'green' }), 'Rose')).toBeNull();
    expect(familyMessage(ev({ type: 'speaker_off', level: 'green' }), 'Rose')).toBeNull();
    expect(familyMessage(ev({ type: 'speaker_on' }), 'Rose')).toBeNull();
    expect(familyMessage(ev({ type: 'off_speaker_requested' }), 'Rose')).toBeNull();
  });
});
