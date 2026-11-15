// Sound + vibration cues for state changes during a call.
// - Sound: Web Audio tones (no files). Browsers only allow audio after a tap, so call
//   unlockAudio() from the tap that starts the call.
// - Vibration: Android only. iOS Safari / Home Screen apps have no vibration API.
import { useEffect, useRef } from 'react';
import type { ElderView } from './callState';

let ctx: AudioContext | null = null;

/** Call from a user gesture (e.g. the Start button) so later alerts can play. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    // A silent blip fully unlocks iOS.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch {
    /* no audio */
  }
}

function tones(notes: [freq: number, start: number, dur: number][], volume = 0.25) {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const [freq, start, dur] of notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + start);
    g.gain.linearRampToValueAtTime(volume, t0 + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + start);
    o.stop(t0 + start + dur + 0.05);
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

const CUES: Partial<Record<ElderView, () => void>> = {
  yellow: () => {
    tones([[660, 0, 0.25]], 0.15);
    vibrate(150);
  },
  verifying: () => {
    tones([[523, 0, 0.18], [784, 0.2, 0.3]], 0.2);
    vibrate([100, 80, 100]);
  },
  red: () => {
    // Three loud descending pairs: hard to miss across a room.
    tones([0, 0.6, 1.2].flatMap((s) => [[880, s, 0.22], [660, s + 0.25, 0.3]] as [number, number, number][]), 0.35);
    vibrate([400, 150, 400, 150, 600]);
  },
};

const RANK: Record<ElderView, number> = { listening: 0, green: 0, yellow: 1, verifying: 2, red: 3 };

/** Plays a cue when the call escalates (never on the way down, never repeated for the same state). */
export function useCallAlerts(view: ElderView, active: boolean) {
  const prev = useRef<ElderView>('listening');
  useEffect(() => {
    if (!active) {
      prev.current = 'listening';
      return;
    }
    if (RANK[view] > RANK[prev.current]) CUES[view]?.();
    prev.current = view;
  }, [view, active]);
}
