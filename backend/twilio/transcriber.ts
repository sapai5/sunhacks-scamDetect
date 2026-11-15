// One Amazon Transcribe streaming session per call track (caller / elder).
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';

const SAMPLE_RATE = 8000;
/** Twilio sends 20 ms frames; Transcribe prefers ~100 ms chunks. */
const CHUNK_BYTES = (SAMPLE_RATE / 10) * 2;

export interface TrackTranscriber {
  /** 16-bit PCM at 8 kHz. Pass muted=true to send silence instead (keeps the stream alive). */
  push(pcm: Buffer, muted: boolean): void;
  stop(): void;
}

export function startTrackTranscriber(
  client: TranscribeStreamingClient,
  onFinal: (text: string) => void,
  onError: (err: unknown) => void,
): TrackTranscriber {
  const queue: Buffer[] = [];
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let wake: (() => void) | null = null;
  let stopped = false;

  async function* audio() {
    while (!stopped) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) yield { AudioEvent: { AudioChunk: queue.shift()! } };
    }
  }

  (async () => {
    try {
      const res = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: 'en-US',
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: SAMPLE_RATE,
          EnablePartialResultsStabilization: true,
          PartialResultsStability: 'medium',
          AudioStream: audio(),
        }),
      );
      for await (const ev of res.TranscriptResultStream ?? []) {
        for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
          const text = r.Alternatives?.[0]?.Transcript?.trim();
          if (text && !r.IsPartial) onFinal(text);
        }
      }
    } catch (err) {
      if (!stopped) onError(err);
    }
  })();

  return {
    push(pcm, muted) {
      if (stopped) return;
      pending.push(muted ? Buffer.alloc(pcm.length) : pcm);
      pendingLen += pcm.length;
      if (pendingLen >= CHUNK_BYTES) {
        queue.push(Buffer.concat(pending, pendingLen));
        pending = [];
        pendingLen = 0;
        wake?.();
      }
    },
    stop() {
      stopped = true;
      wake?.();
    },
  };
}
