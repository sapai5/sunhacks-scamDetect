import { describe, expect, it } from 'vitest';
import { detectExposures, exposureSentence, mergeExposures, whatNext } from '../../contracts/exposures.js';
import { elderAlertsFor } from '../lambda/shared/elderAlerts.js';
import { parseRequest, parseVerdict } from '../lambda/analyze/rules.js';
import { TEST_SCRIPTS } from '../scripts/test-scripts.js';

const caller = (text: string) => ({ speaker: 'caller', text });
const elder = (text: string) => ({ speaker: 'elder', text });

describe('detectExposures: what the elder actually handed over', () => {
  it('a card number read out after the caller asked for it', () => {
    expect(
      detectExposures([
        caller("We've flagged suspicious charges on your debit card."),
        caller('Please read me the card number on the front.'),
        elder("Let me get my purse. Okay, it's four one two eight, seven seven zero three..."),
      ]),
    ).toEqual(['card_number']);
  });

  it('three digits is a false start, not an exposure', () => {
    expect(detectExposures([caller('Can you confirm your card number?'), elder("It's four one two...")])).toEqual([]);
  });

  it('a legit caller stopping the elder: their "never need" line is not an ask', () => {
    expect(
      detectExposures([
        caller('Hi Rose, this is Sam at Desert Financial. Your new card was mailed.'),
        elder('Yes, thank you! Do you need my card number? It starts four one two...'),
        caller("Please stop there, we never need you to read us your card number."),
        elder('Oh, okay. Thank you, Sam.'),
      ]),
    ).toEqual([]);
  });

  it('SSN, text code, gift cards, remote access, money sent', () => {
    expect(detectExposures([caller('I just need to confirm your Social Security number.'), elder('Five two seven, four four, nine one zero two.')])).toEqual(['ssn']);
    expect(detectExposures([caller('Read me the six digit code we just texted you.'), elder('Okay, it says eight four two, one nine seven.')])).toEqual(['one_time_code']);
    expect(
      detectExposures([
        caller('You can settle it today with Google Play cards.'),
        elder("Okay, okay. I'm at the store now. I bought five hundred dollars of the cards."),
        caller('Scratch off the back and read me the codes, one at a time.'),
        elder('The first one is X seven Q two, nine B four K...'),
      ]),
    ).toEqual(['gift_cards']);
    expect(detectExposures([caller('Go to anydesk dot com and install it on your computer.'), elder("Okay, I'm typing in AnyDesk now.")])).toEqual(['remote_access']);
    expect(detectExposures([caller('Did you send it?'), elder('Yes, I sent it on Zelle a minute ago.')])).toEqual(['money_sent']);
  });

  it('a promise to pay is not money sent, and the agent never counts', () => {
    expect(detectExposures([caller('Grandma I need bail.'), elder("I'll send it to you on Zelle right now.")])).toEqual([]);
    expect(detectExposures([caller('Read me your card number.'), { speaker: 'agent', text: 'Four one two eight seven seven' }])).toEqual([]);
  });
});

describe('the demo scripts (what you see in the app)', () => {
  it('only the tech support scam hands something over; no legit call ever does', () => {
    const hits = Object.fromEntries(TEST_SCRIPTS.map((s) => [s.name, detectExposures(s.lines)]).filter(([, e]) => e.length));
    expect(hits).toEqual({ 'tech-support-scam': ['remote_access'] });
  });
});

describe('merging and wording', () => {
  it('keeps one fixed order and drops unknown values', () => {
    expect(mergeExposures(['ssn'], ['card_number', 'nonsense'], undefined, ['ssn'])).toEqual(['card_number', 'ssn']);
  });
  it('reads as a sentence', () => {
    expect(exposureSentence(['card_number'])).toBe('your card number');
    expect(exposureSentence(['one_time_code'])).toBe('a text code');
    expect(exposureSentence(['remote_access'])).toBe('access to your computer');
    expect(exposureSentence(['card_number', 'one_time_code', 'money_sent'])).toBe('your card number, a text code and money');
    expect(exposureSentence(['ssn', 'remote_access'], 'their')).toBe('their Social Security number and access to their computer');
  });
  it('the model and the request carry exposures through', () => {
    expect(parseVerdict('{"risk":80,"tactics":[],"reason":"x","elderState":"complying","exposures":["ssn","bogus"]}').exposures).toEqual(['ssn']);
    expect(parseRequest({ callId: 'c', elderId: 'e-01', utterances: [], exposures: ['card_number'] }).exposures).toEqual(['card_number']);
  });
});

describe('whatNext: the steps after the call', () => {
  it('nothing handed over: no steps, or only the general ones on a likely scam', () => {
    expect(whatNext([])).toEqual([]);
    expect(whatNext([], { scam: true }).map((s) => s.id)).toEqual(['family', 'callbacks', 'report']);
  });
  it('most urgent first, then the steps for every scam', () => {
    const ids = whatNext(['ssn', 'card_number', 'remote_access'], { familyPhone: '(602) 555-0100' }).map((s) => s.id);
    expect(ids).toEqual(['remote_access', 'card_number', 'ssn', 'ssn_experian', 'ssn_transunion', 'family', 'callbacks', 'report']);
  });
  it('the family step calls the family when we have a number', () => {
    const family = whatNext(['card_number'], { familyPhone: '(602) 555-0100' }).find((s) => s.id === 'family');
    expect(family?.call?.tel).toBe('6025550100');
    expect(whatNext(['card_number']).find((s) => s.id === 'family')?.call).toBeUndefined();
  });
});

describe('end-of-call alert when something was handed over', () => {
  it('says what was shared and points to the steps', () => {
    const [a] = elderAlertsFor({ level: 'red', peak: 'red' }, { level: 'red', peak: 'red', ended: true, exposures: ['card_number'] }, 'CA1');
    expect(a).toMatchObject({ kind: 'ended', title: 'You may have given the caller your card number' });
  });
  it('still sent after a confirmed scam, if something leaked before the agent took over', () => {
    const before = { agentStatus: 'scam_confirmed' as const, peak: 'red' as const };
    expect(elderAlertsFor(before, { ...before, ended: true }, 'CA1')).toEqual([]);
    expect(elderAlertsFor(before, { ...before, ended: true, exposures: ['ssn'] }, 'CA1').map((x) => x.kind)).toEqual(['ended']);
  });
});
