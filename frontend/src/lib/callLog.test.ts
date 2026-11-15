import { describe, expect, it } from 'vitest';
import type { RiskState } from '../../../contracts/index.js';
import { entryFor } from './callLog';
import { EMPTY_SNAPSHOT, type CallSnapshot } from './snapshot';

const risk = (level: RiskState['level'], tactics: RiskState['tactics'] = []): RiskState => ({
  callId: 'c-1',
  risk: level === 'red' ? 90 : level === 'yellow' ? 50 : 10,
  level,
  tactics,
  reason: '',
  action: 'none',
  updatedAt: 0,
  calmStreak: 0,
  claimedRelative: false,
  elderState: 'none',
  familyAlerted: false,
});
const line = (seq: number, text: string) => ({ callId: 'c-1', elderId: 'e-01', speaker: 'caller', text, ts: seq * 1000, seq });
const snap = (p: Partial<CallSnapshot>): CallSnapshot => ({ ...EMPTY_SNAPSHOT, callId: 'c-1', startedAt: 1000, running: true, ...p });

describe('entryFor', () => {
  it('skips calls with nothing heard or scored yet', () => {
    expect(entryFor(snap({}))).toBeNull();
    expect(entryFor({ ...EMPTY_SNAPSHOT })).toBeNull();
  });

  it('keeps the peak level after the call calms down', () => {
    const e = entryFor(
      snap({
        risk: risk('yellow'),
        transcript: [line(0, 'hi')],
        history: [
          { seq: 0, risk: 90, level: 'red', newTactics: ['gift_cards'] },
          { seq: 1, risk: 50, level: 'yellow', newTactics: [] },
        ],
      }),
    );
    expect(e).toMatchObject({ peak: 'red', tactics: ['gift_cards'] });
  });

  it("doesn't drop a saved transcript when a later snapshot has fewer lines", () => {
    const prev = entryFor(snap({ risk: risk('red', ['urgency']), transcript: [line(0, 'a'), line(1, 'b')] }))!;
    const e = entryFor(snap({ risk: risk('yellow'), transcript: [] }), prev)!;
    expect(e.transcript).toHaveLength(2);
    expect(e.peak).toBe('red');
    expect(e.tactics).toContain('urgency');
  });

  it('keeps what the elder handed over, from the backend and from the transcript', () => {
    const said = [line(0, 'Read me the card number on the front.'), { ...line(1, 'Four one two eight, seven seven zero three'), speaker: 'elder' }];
    const prev = entryFor(snap({ risk: { ...risk('red'), exposures: ['ssn'] }, transcript: said }))!;
    expect(prev.exposures).toEqual(['card_number', 'ssn']);
    // A later result without them (e.g. a phone call after a reload) doesn't erase them.
    expect(entryFor(snap({ risk: risk('red'), transcript: [] }), prev)!.exposures).toEqual(['card_number', 'ssn']);
  });

  it('remembers that the family was alerted', () => {
    const prev = entryFor(snap({ risk: { ...risk('red'), familyAlerted: true } }))!;
    expect(entryFor(snap({ risk: risk('red') }), prev)!.familyAlerted).toBe(true);
  });
});
