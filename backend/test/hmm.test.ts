import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyzeRequest, ElderSettings, Utterance } from '../../contracts/index.js';
import { extract, scoreHmm } from '../lambda/analyze/hmm/hmm.js';
import { TEST_SCRIPTS } from '../scripts/test-scripts.js';

const askClaude = vi.fn();
vi.mock('../lambda/shared/bedrock.js', () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));
const { blend, hmmOnlyVerdict, score } = await import('../lambda/analyze/score.js');

const utterances = (lines: { speaker: string; text: string }[]): Utterance[] =>
  lines.map((l, i) => ({ callId: 'c', elderId: 'e', speaker: l.speaker, text: l.text, ts: 1_000 + i * 4_000, seq: i }));

describe('phrase HMM (TypeScript port)', () => {
  // Golden traces from the Python model that produced model.json (ml/hmm/results/1553096).
  const golden = JSON.parse(readFileSync(new URL('../../ml/hmm/results/1553096/results.json', import.meta.url), 'utf8'))
    ._our_scripts as Record<string, { trace: number[] }>;

  it.each(TEST_SCRIPTS.map((s) => [s.name, s] as const))('matches the Python filter on %s', (name, s) => {
    const { trace } = scoreHmm(utterances(s.lines));
    expect(trace).toHaveLength(golden[name].trace.length);
    trace.forEach((p, i) => expect(p).toBeCloseTo(golden[name].trace[i], 3));
  });

  it('negates disclaimed asks but not real ones', () => {
    const neg = extract('C', 'We will never ask for your PIN, your full card number or a code.');
    // "PIN" and "card number" (a bare "a code" is not in the lexicon).
    expect(neg.map((p) => [p.category, !!p.negated])).toEqual([['INFO', true], ['INFO', true]]);
    expect(extract('C', 'Please read me the numbers on the back.')[0]).toMatchObject({ category: 'INFO' });
    expect(extract('C', 'Please read me the numbers on the back.')[0].negated).toBeUndefined();
  });

  it('maps phrase categories to contract tactics', () => {
    const r = scoreHmm(utterances([
      { speaker: 'caller', text: 'Grandma, it is me. Go buy gift cards and send it by Western Union right now.' },
      { speaker: 'elder', text: 'Okay, I will go to the store.' },
    ]));
    expect(r.tactics).toEqual(expect.arrayContaining(['gift_cards', 'wire_or_crypto', 'urgency']));
    expect(r.claimedRelative).toBe(true);
  });
});

describe('ensemble scoring', () => {
  const elder = { elderId: 'e', elderName: 'Rose', verificationQuestion: 'Dog?', verificationAnswer: 'Biscuit',
    agentName: 'Mike', agentRelation: 'son', family: [], trustedContacts: [] } as ElderSettings;
  const req = (name: string): AnalyzeRequest => ({
    callId: 'c', elderId: 'e', utterances: utterances(TEST_SCRIPTS.find((s) => s.name === name)!.lines),
    prevLevel: 'green', calmStreak: 0, verification: 'unasked', familyAlerted: false, agentStatus: 'idle',
  });
  beforeEach(() => askClaude.mockReset());

  it('blends 0.65 Claude + 0.35 HMM', () => {
    const v = { risk: 80, tactics: [], reason: '', claimedRelative: false, elderState: 'none' as const };
    expect(blend(v, { pScam: 0.2 } as never, 0.35).risk).toBe(Math.round(0.65 * 80 + 0.35 * 20));
    expect(blend(v, { pScam: 0.2 } as never, 0).risk).toBe(80);
  });

  it('uses the blended risk when Claude answers', async () => {
    askClaude.mockResolvedValue('{"risk": 90, "tactics": ["gift_cards","secrecy","urgency"], "reason": "x", "claimedRelative": true, "elderState": "engaging"}');
    const r = req('grandparent-scam');
    const { state } = await score(r, elder);
    const p = scoreHmm(r.utterances).pScam;
    expect(state.risk).toBe(Math.round(0.65 * 90 + 0.35 * 100 * p));
    expect(state.level).toBe('red');
  });

  // Unusable model output takes the same path as a Bedrock error (score.ts catches both).
  it('falls back to the HMM alone when Claude fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    askClaude.mockResolvedValue('Sorry, I cannot help with that.');
    const scam = await score(req('tech-support-scam'), elder);
    expect(scam.state.level).not.toBe('green');
    expect(scam.state.reason).toMatch(/phrase model/);
    expect(scam.state.action).not.toBe('agent_takeover');
    const legit = await score(req('bank-fraud-check-legit'), elder);
    expect(legit.state.level).toBe('green');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('never claims the elder is complying from phrases alone', () => {
    expect(hmmOnlyVerdict({ pScam: 1, tactics: [], categories: new Set(), trace: [], claimedRelative: false, receiverComplied: true }).elderState).toBe('engaging');
  });
});
