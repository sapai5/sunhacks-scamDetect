// Browser mic -> Amazon Transcribe streaming. Emits partial and final sentences
// with a diarization speaker label (spk_0, spk_1, ...).
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';

const SAMPLE_RATE = 16000;

export interface TranscriberEvents {
  onPartial(text: string): void;
  onFinal(text: string, speaker: string): void;
  onError(err: unknown): void;
}

export interface Transcriber {
  stop(): void;
  /** While muted, silence is sent instead of mic audio, so the agent's own voice isn't transcribed. */
  setMuted(muted: boolean): void;
}

// AudioWorklet that posts Float32 mic frames to the main thread.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('tap', Tap);`;

export async function startTranscriber(events: TranscriberEvents): Promise<Transcriber> {
  const credsRes = await fetch(import.meta.env.VITE_CREDENTIALS_URL, { method: 'POST' });
  if (!credsRes.ok) throw new Error(`credentials: HTTP ${credsRes.status}`);
  const creds = await credsRes.json();

  const stream = await navigator.mediaDevices.getUserMedia({
    // Speakerphone audio: keep echo cancellation off so the caller's voice isn't removed.
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'tap');
  source.connect(tap);

  // Simple async queue of PCM chunks for the SDK's audio stream.
  const queue: Uint8Array[] = [];
  let wake: (() => void) | null = null;
  let stopped = false;
  let muted = false;
  let pending: Float32Array[] = [];
  let pendingLen = 0;
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    pending.push(e.data);
    pendingLen += e.data.length;
    // Send ~100 ms chunks.
    if (pendingLen >= ctx.sampleRate / 10) {
      const merged = new Float32Array(pendingLen);
      let o = 0;
      for (const p of pending) { merged.set(p, o); o += p.length; }
      pending = [];
      pendingLen = 0;
      const pcm = downsample(merged, ctx.sampleRate, SAMPLE_RATE);
      if (muted) pcm.fill(0);
      queue.push(toPcm16(pcm));
      wake?.();
    }
  };

  async function* audioStream() {
    while (!stopped) {
      if (queue.length === 0) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) yield { AudioEvent: { AudioChunk: queue.shift()! } };
    }
  }

  const client = new TranscribeStreamingClient({
    region: creds.region ?? import.meta.env.VITE_REGION,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken },
  });

  (async () => {
    try {
      const res = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: 'en-US',
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: SAMPLE_RATE,
          EnablePartialResultsStabilization: true,
          PartialResultsStability: 'medium',
          ShowSpeakerLabel: true,
          AudioStream: audioStream(),
        }),
      );
      for await (const ev of res.TranscriptResultStream ?? []) {
        for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
          const alt = r.Alternatives?.[0];
          const text = alt?.Transcript?.trim();
          if (!text) continue;
          if (r.IsPartial) events.onPartial(text);
          else events.onFinal(text, majoritySpeaker(alt?.Items ?? []));
        }
      }
    } catch (err) {
      if (!stopped) events.onError(err);
    }
  })();

  return {
    setMuted: (m) => (muted = m),
    stop: () => {
      stopped = true;
      wake?.();
      tap.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      client.destroy();
    },
  };
}

/** A sentence can span speakers; label it with whoever spoke most of its words. */
function majoritySpeaker(items: { Speaker?: string; Type?: string }[]): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.Type === 'pronunciation' && it.Speaker) counts.set(it.Speaker, (counts.get(it.Speaker) ?? 0) + 1);
  }
  let best = 'unknown';
  let max = 0;
  for (const [s, n] of counts) if (n > max) [best, max] = [`spk_${s}`, n];
  return best;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function toPcm16(input: Float32Array): Uint8Array {
  const buf = new DataView(new ArrayBuffer(input.length * 2));
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    buf.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf.buffer);
}
