// Hang-up / speakerphone detection from the mic, for a device sitting next to a speakerphone.
// It can't read the phone's call state, so it infers it from sound, every ~100 ms:
//
//   voice_lost   no voice-like audio for `lostAfterMs` after voice was heard
//                (call taken off speaker, put on hold, or ended)
//   voice_back   voice-like audio again after voice_lost (back on speaker)
//   tone         a dial tone (350+440 Hz) or busy/reorder tone (480+620 Hz): the call ended
//   long_silence no voice for `silenceAfterMs`: the call has probably ended
//
// Pure (no browser APIs), so it's unit tested with synthetic audio.

export type PresenceEventType = 'voice_lost' | 'voice_back' | 'tone' | 'long_silence';
export interface PresenceEvent {
  type: PresenceEventType;
  detail: string;
}

export interface PresenceOptions {
  lostAfterMs: number;
  silenceAfterMs: number;
  /** How long a tone must last before it counts. */
  toneMs: number;
}

const DEFAULTS: PresenceOptions = { lostAfterMs: 12_000, silenceAfterMs: 30_000, toneMs: 1_500 };

/** North American call-progress tones (dual-frequency). */
const TONES = [
  { name: 'dial tone', freqs: [350, 440] },
  { name: 'busy tone', freqs: [480, 620] },
] as const;

/** Normalised Goertzel power: ~1 for a pure sine exactly at `freq`, ~0 for unrelated sound. */
function toneShare(x: Float32Array, sampleRate: number, freq: number, energy: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return energy > 0 ? power / ((x.length * energy) / 2) : 0;
}

export class AudioPresence {
  private opts: PresenceOptions;
  private floor = 0.002;
  private lastVoiceAt = 0;
  private heardVoice = false;
  private lost = false;
  private silenceFired = false;
  private toneFor = 0;
  private toneFired = false;
  /** Last RMS level, 0..1 (for a level meter). */
  level = 0;

  constructor(opts: Partial<PresenceOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Feed ~100 ms of mono audio. Returns any events this chunk triggered. */
  push(chunk: Float32Array, sampleRate: number, now = Date.now()): PresenceEvent[] {
    const events: PresenceEvent[] = [];
    const ms = (chunk.length / sampleRate) * 1000;

    let energy = 0;
    for (let i = 0; i < chunk.length; i++) energy += chunk[i] * chunk[i];
    const rms = Math.sqrt(energy / Math.max(1, chunk.length));
    this.level = rms;

    // Call-progress tone?
    let tone: string | null = null;
    if (rms > 0.005) {
      for (const t of TONES) {
        const share = t.freqs.reduce((sum, f) => sum + toneShare(chunk, sampleRate, f, energy), 0);
        if (share > 0.6) tone = t.name;
      }
    }
    if (tone) {
      this.toneFor += ms;
      if (this.toneFor >= this.opts.toneMs && !this.toneFired) {
        this.toneFired = true;
        events.push({ type: 'tone', detail: `${tone[0].toUpperCase()}${tone.slice(1)} heard` });
      }
    } else {
      this.toneFor = 0;
    }

    // Adaptive noise floor: falls fast, rises slowly (so speech doesn't drag it up).
    this.floor = rms < this.floor ? 0.7 * this.floor + 0.3 * rms : this.floor * 1.002;
    this.floor = Math.max(this.floor, 0.0005);
    const voice = !tone && rms > Math.max(0.01, this.floor * 4);

    if (voice) {
      this.lastVoiceAt = now;
      if (this.lost) {
        this.lost = false;
        events.push({ type: 'voice_back', detail: 'Caller audio is back' });
      }
      this.heardVoice = true;
      this.silenceFired = false;
    } else if (this.heardVoice) {
      const quietFor = now - this.lastVoiceAt;
      if (!this.lost && quietFor >= this.opts.lostAfterMs) {
        this.lost = true;
        events.push({ type: 'voice_lost', detail: `No caller audio for ${Math.round(quietFor / 1000)} s` });
      }
      if (!this.silenceFired && quietFor >= this.opts.silenceAfterMs) {
        this.silenceFired = true;
        events.push({ type: 'long_silence', detail: `Silent for ${Math.round(quietFor / 1000)} s` });
      }
    }
    return events;
  }

  /** The elder said "still on speaker": start the quiet timer over. */
  reset(now = Date.now()) {
    this.lastVoiceAt = now;
    this.lost = false;
    this.silenceFired = false;
  }
}

/** The caller trying to get off speaker or to get the elder alone (an isolation tactic). */
export const OFF_SPEAKER_REQUEST =
  /\b(take (?:me|this|it) off (?:the )?speaker|turn (?:off|down) (?:the )?speaker|(?:get|go) off (?:the )?speaker|pick up the (?:phone|handset|receiver)|put the phone (?:to|on) your ear|is (?:anyone|anybody|someone) (?:else )?(?:there|listening|with you)|are you alone)\b/i;
