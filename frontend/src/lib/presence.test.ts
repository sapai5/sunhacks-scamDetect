import { describe, expect, it } from 'vitest';
import { AudioPresence, OFF_SPEAKER_REQUEST, type PresenceEvent } from './presence';

const SR = 16_000;
const N = 1_600; // 100 ms chunks

/** Seeded noise bursts that look like speech energy (broadband, not tonal). */
function speechChunk(seed: number, amp = 0.15): Float32Array {
  let s = seed;
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    x[i] = ((s / 0x7fffffff) * 2 - 1) * amp;
  }
  return x;
}
const silence = () => new Float32Array(N).map(() => (Math.random() * 2 - 1) * 0.0005);
function toneChunk(freqs: number[], offset: number): Float32Array {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) for (const f of freqs) x[i] += 0.2 * Math.sin((2 * Math.PI * f * (offset + i)) / SR);
  return x;
}

/** Run chunks through the detector, collecting events with their time. */
function run(p: AudioPresence, chunks: Float32Array[], t0 = 0) {
  const out: (PresenceEvent & { t: number })[] = [];
  chunks.forEach((c, i) => p.push(c, SR, t0 + i * 100).forEach((e) => out.push({ ...e, t: t0 + i * 100 })));
  return out;
}
const times = (n: number, f: (i: number) => Float32Array) => Array.from({ length: n }, (_, i) => f(i));

describe('AudioPresence', () => {
  it('flags the caller going quiet (off speaker), then coming back', () => {
    const p = new AudioPresence();
    const ev = run(p, [...times(30, (i) => speechChunk(i + 1)), ...times(130, silence), ...times(5, (i) => speechChunk(i + 99))]);
    expect(ev.map((e) => e.type)).toEqual(['voice_lost', 'voice_back']);
    expect(ev[0].t).toBeGreaterThanOrEqual(2_900 + 12_000);
  });

  it('flags a long silence as a likely hang-up', () => {
    const p = new AudioPresence();
    const ev = run(p, [...times(10, (i) => speechChunk(i + 1)), ...times(320, silence)]);
    expect(ev.map((e) => e.type)).toEqual(['voice_lost', 'long_silence']);
  });

  it('hears a dial tone and a busy tone, and does not count them as voice', () => {
    const dial = run(new AudioPresence(), [...times(10, (i) => speechChunk(i + 1)), ...times(20, (i) => toneChunk([350, 440], i * N))]);
    expect(dial.find((e) => e.type === 'tone')?.detail).toBe('Dial tone heard');
    const busy = run(new AudioPresence(), times(20, (i) => toneChunk([480, 620], i * N)));
    expect(busy.find((e) => e.type === 'tone')?.detail).toBe('Busy tone heard');
  });

  it('ignores silence before anyone has spoken, and reset() restarts the quiet timer', () => {
    const p = new AudioPresence();
    expect(run(p, times(200, silence))).toEqual([]);
    run(p, times(5, (i) => speechChunk(i + 1)), 20_000);
    p.reset(30_000);
    expect(run(p, times(50, silence), 30_100)).toEqual([]);
  });
});

describe('OFF_SPEAKER_REQUEST', () => {
  it('catches isolation requests, not normal speaker talk', () => {
    expect(OFF_SPEAKER_REQUEST.test("Can you take me off speaker? I don't want anyone else to hear this.")).toBe(true);
    expect(OFF_SPEAKER_REQUEST.test('Is anyone else listening?')).toBe(true);
    expect(OFF_SPEAKER_REQUEST.test('Pick up the phone, Grandma.')).toBe(true);
    expect(OFF_SPEAKER_REQUEST.test("You're on speaker, that's fine.")).toBe(false);
  });
});
