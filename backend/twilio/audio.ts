// Twilio Media Streams send 8 kHz mono G.711 mu-law. Amazon Transcribe wants 16-bit PCM.

function decodeMulaw(byte: number): number {
  const u = ~byte & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

const TABLE = Int16Array.from({ length: 256 }, (_, i) => decodeMulaw(i));

/** mu-law bytes -> little-endian 16-bit PCM (same sample rate, 8 kHz). */
export function mulawToPcm16(mulaw: Uint8Array): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) out.writeInt16LE(TABLE[mulaw[i]], i * 2);
  return out;
}

/** 16-bit PCM sample -> mu-law byte (G.711). Used by the simulator and tests. */
export function encodeMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  let s = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function pcm16ToMulaw(pcm: Buffer): Uint8Array {
  const out = new Uint8Array(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = encodeMulaw(pcm.readInt16LE(i * 2));
  return out;
}

/** Rough speaking time for a line of text-to-speech, so we can stop transcribing our own voice. */
export function speechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return 800 + words * 400; // ~150 words/min, plus Twilio's fetch of the announce TwiML
}
