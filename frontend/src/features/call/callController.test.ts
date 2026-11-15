import { describe, expect, it } from 'vitest';
import type { AnalyzeRequest } from '@contracts';
import { TEST_SCRIPTS } from '@backend/scripts/test-scripts';
import { createMockAnalyzeClient } from '../../services/analyze/mockAnalyzeClient';
import type { AnalyzeClient, TranscriptHandlers, TranscriptSource } from '../../services/types';
import { CallController, emptyRisk } from './callController';

/** A source the test drives by hand. */
function manualSource() {
  let h: TranscriptHandlers | null = null;
  let stopped = false;
  const source: TranscriptSource = {
    async start(handlers) {
      h = handlers;
      return () => (stopped = true);
    },
  };
  return { source, say: (t: string) => h!.onFinal(t), partial: (t: string) => h!.onPartial(t), isStopped: () => stopped };
}

let id = 0;
const make = (analyze: AnalyzeClient) => new CallController({ analyze, elderId: 'e-01', newCallId: () => `c-${++id}` });

describe('CallController', () => {
  it('serializes analyze calls and carries the previous level and calm streak', async () => {
    const seen: AnalyzeRequest[] = [];
    const levels = ['yellow', 'green', 'green'] as const;
    const c = make({
      async analyze(req) {
        seen.push(structuredClone(req));
        const level = levels[seen.length - 1];
        return { ...emptyRisk(req.callId), level, risk: level === 'yellow' ? 50 : 0, calmStreak: seen.length - 1 };
      },
    });
    const m = manualSource();
    await c.start(m.source, 'mic');
    for (const t of ['one', 'two', 'three']) {
      m.say(t);
      await c.whenIdle();
    }

    expect(seen.map((r) => r.utterances.length)).toEqual([1, 2, 3]);
    expect(seen.map((r) => r.prevLevel)).toEqual(['green', 'yellow', 'green']);
    expect(seen.map((r) => r.calmStreak)).toEqual([0, 0, 1]);
    expect(c.getSnapshot().peakLevel).toBe('yellow');
    expect(c.getSnapshot().peakRisk).toBe(50);
  });

  it('coalesces sentences that arrive while a request is in flight', async () => {
    const seen: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const c = make({
      async analyze(req) {
        seen.push(req.utterances.length);
        if (seen.length === 1) await gate;
        return emptyRisk(req.callId);
      },
    });
    const m = manualSource();
    await c.start(m.source, 'mic');
    m.say('one');
    await Promise.resolve(); // first request starts
    m.say('two');
    m.say('three');
    m.say('four');
    release();
    await c.whenIdle();
    expect(seen).toEqual([1, 4]);
  });

  it('keeps the last result when analyze fails', async () => {
    let fail = false;
    const c = make({
      async analyze(req) {
        if (fail) throw new Error('HTTP 502');
        return { ...emptyRisk(req.callId), level: 'yellow', risk: 55, tactics: ['urgency'] };
      },
    });
    const m = manualSource();
    await c.start(m.source, 'mic');
    m.say('hurry');
    await c.whenIdle();
    fail = true;
    m.say('again');
    await c.whenIdle();
    const s = c.getSnapshot();
    expect(s.risk.level).toBe('yellow');
    expect(s.status).toMatch(/HTTP 502/);
  });

  it('stops the source and ignores input after the call ends', async () => {
    const c = make(createMockAnalyzeClient({ latencyMs: 0 }));
    const m = manualSource();
    await c.start(m.source, 'mic');
    m.partial('hel');
    c.stop();
    m.say('late sentence');
    expect(m.isStopped()).toBe(true);
    expect(c.getSnapshot().phase).toBe('ended');
    expect(c.getSnapshot().utterances).toHaveLength(0);
    expect(c.getSnapshot().partial).toBe('');
  });

  it('ends with an error when the source cannot start', async () => {
    const c = make(createMockAnalyzeClient({ latencyMs: 0 }));
    const ok = await c.start({ start: () => Promise.reject(new Error('mic denied')) }, 'mic');
    expect(ok).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', error: 'mic denied' });
  });

  it('grandparent scam with the mock backend: asks to verify, then goes red and alerts once', async () => {
    const script = TEST_SCRIPTS.find((s) => s.name === 'grandparent-scam')!;
    const c = make(createMockAnalyzeClient({ latencyMs: 0 }));
    const m = manualSource();
    await c.start(m.source, 'demo', 'Grandparent scam');

    let asked = false;
    for (const line of script.lines) {
      m.say(line);
      await c.whenIdle();
      if (c.getSnapshot().pendingQuestion && !asked) {
        asked = true;
        c.answerVerification('failed');
        await c.whenIdle();
      }
    }
    const s = c.getSnapshot();
    expect(asked).toBe(true);
    expect(s.peakLevel).toBe('red');
    expect(s.familyAlerted).toBe(true);
    expect(s.tacticsSeen).toEqual(expect.arrayContaining(['impersonation', 'gift_cards']));
  });

  it('legit calls stay green with the mock backend', async () => {
    for (const script of TEST_SCRIPTS.filter((s) => s.expectedPeak === 'green')) {
      const c = make(createMockAnalyzeClient({ latencyMs: 0 }));
      const m = manualSource();
      await c.start(m.source, 'demo');
      for (const line of script.lines) m.say(line);
      await c.whenIdle();
      expect({ name: script.name, peak: c.getSnapshot().peakLevel }).toEqual({ name: script.name, peak: 'green' });
    }
  });
});
