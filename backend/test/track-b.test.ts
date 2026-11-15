import { describe, expect, it } from 'vitest';
import { BadRequest, decide, parseIngest } from '../lambda/analyze/rules.js';
import { parseSettingsPatch } from '../lambda/settings/rules.js';

const fresh = { prevLevel: 'green', calmStreak: 0, verification: 'unasked', familyAlerted: false, agentStatus: 'idle' } as const;

describe('decide: early red', () => {
  it('impersonation + urgency alone stays yellow (a real family emergency sounds like this)', () => {
    const d = decide({ risk: 75, tactics: ['impersonation', 'urgency'], reason: '', claimedRelative: true, elderState: 'engaging' }, fresh);
    expect(d.level).toBe('yellow');
    expect(d.shouldAlert).toBe(false);
  });

  it('goes red once there is an ask, secrecy or a threat', () => {
    for (const t of ['payment_request', 'secrecy', 'threats'] as const) {
      expect(decide({ risk: 75, tactics: ['impersonation', t], reason: '', claimedRelative: true, elderState: 'none' }, fresh).level).toBe('red');
    }
  });
});

describe('parseIngest', () => {
  it('accepts a transcriber sentence and defaults ts', () => {
    const r = parseIngest({ callId: 'contact-1', elderId: 'e-01', speaker: 'caller', text: 'Hi Grandma' });
    expect(r).toMatchObject({ callId: 'contact-1', elderId: 'e-01', speaker: 'caller', text: 'Hi Grandma' });
    expect(r.ts).toBeGreaterThan(0);
  });

  it('rejects other speakers, empty text and missing ids', () => {
    expect(() => parseIngest({ callId: 'c', elderId: 'e', speaker: 'spk_0', text: 'x' })).toThrow(BadRequest);
    expect(() => parseIngest({ callId: 'c', elderId: 'e', speaker: 'elder', text: '  ' })).toThrow(BadRequest);
    expect(() => parseIngest({ elderId: 'e', speaker: 'elder', text: 'x' })).toThrow(BadRequest);
    expect(() => parseIngest(null)).toThrow(BadRequest);
  });
});

describe('parseSettingsPatch', () => {
  it('keeps known fields, trims text and drops unknown ones', () => {
    const r = parseSettingsPatch({
      elderId: 'e-01',
      verificationQuestion: ' Name of our first cat? ',
      family: [{ name: 'Maria', phone: '+1 (480) 555-0193' }],
      trustedContacts: ['+14805550193'],
      connections: ['steal-the-socket'],
    });
    expect(r).toEqual({
      elderId: 'e-01',
      patch: { verificationQuestion: 'Name of our first cat?', family: [{ name: 'Maria', phone: '+1 (480) 555-0193' }], trustedContacts: ['+14805550193'] },
    });
  });

  it('rejects empty answers, non-E.164 trusted numbers and empty patches', () => {
    expect(() => parseSettingsPatch({ elderId: 'e-01', verificationAnswer: '' })).toThrow(BadRequest);
    expect(() => parseSettingsPatch({ elderId: 'e-01', trustedContacts: ['480-555-0193'] })).toThrow(BadRequest);
    expect(() => parseSettingsPatch({ elderId: 'e-01' })).toThrow(BadRequest);
    expect(() => parseSettingsPatch({ verificationAnswer: 'x' })).toThrow(BadRequest);
  });
});
