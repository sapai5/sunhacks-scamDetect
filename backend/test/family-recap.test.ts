import { describe, expect, it } from 'vitest';
import { familyPhones, familyRecap, type FamilyRecapInput } from '../lambda/shared/familyRecap.js';

const base: FamilyRecapInput = {
  elderName: 'Rose',
  webUrl: 'https://app.example.com/',
  callId: 'CA 1',
};

describe('familyRecap', () => {
  it('stays quiet when the call looked safe', () => {
    expect(familyRecap({ ...base, level: 'green' })).toBeNull();
    expect(familyRecap({ ...base, level: 'green', agentStatus: 'idle', elderState: 'none' })).toBeNull();
  });

  it('tells close contacts what a scam call did, without the transcript', () => {
    const text = familyRecap({
      ...base,
      level: 'red',
      familyAlerted: true,
      reason: 'A man said he was her grandson in jail and asked her to buy gift cards.',
      tactics: ['impersonation', 'secrecy', 'gift_cards'],
      claimedRelative: true,
      elderState: 'complying',
      exposures: ['gift_cards'],
      agentStatus: 'scam_confirmed',
      agentName: 'Mike',
      agentSummary: 'Caller said his name was David and wanted $2,000 in Target cards sent to a courier.',
    });
    expect(text).toContain('Rose just hung up on a call that looked like a scam.');
    expect(text).toContain('grandson in jail');
    expect(text).toContain('pretended to be a relative or an official');
    expect(text).toContain('asked for gift cards');
    expect(text).toContain('Rose was going along with what the caller asked.');
    expect(text).toContain('may have given the caller gift cards');
    expect(text).toContain('Mike joined the call, decided it was a scam, and ended it.');
    expect(text).toContain('David');
    expect(text).toContain('$2,000 in Target cards');
    expect(text).toContain("Don't trust a call back from that number.");
    expect(text).toContain('https://app.example.com/elder/call?id=CA%201');
    expect(text!.length).toBeLessThanOrEqual(1400);
  });

  it('still reports a call that cooled off after the family was already alerted', () => {
    const text = familyRecap({ ...base, level: 'green', familyAlerted: true, reason: 'He asked for bail money.' });
    expect(text).toContain('looked like a scam');
    expect(text).toContain('bail money');
  });

  it('mentions warning signs on a yellow call', () => {
    const text = familyRecap({ ...base, level: 'yellow', tactics: ['urgency'], elderState: 'engaging' });
    expect(text).toContain('warning signs');
    expect(text).toContain('pressured them to act right now');
    expect(text).toContain('starting to go along');
  });
});

describe('familyPhones', () => {
  it('texts each saved contact once, in E.164, and skips the elder', () => {
    expect(
      familyPhones(
        [
          { phone: '+1 (480) 555-0193' },
          { phone: '4805550193' },
          { phone: '+16025550100' },
          { phone: '' },
          { phone: 'nope' },
        ],
        '+14805550100',
      ),
    ).toEqual(['+14805550193', '+16025550100']);
  });
});
