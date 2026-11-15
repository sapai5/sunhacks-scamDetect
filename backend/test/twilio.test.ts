import { describe, expect, it } from 'vitest';
import { encodeMulaw, mulawToPcm16, pcm16ToMulaw, speechMs } from '../twilio/audio.js';
import { directDial, sayLine, screenedCall } from '../twilio/twiml.js';

describe('mu-law audio', () => {
  it('round-trips samples within G.711 quantization error', () => {
    for (const s of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
      const back = mulawToPcm16(Uint8Array.of(encodeMulaw(s))).readInt16LE(0);
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(8, Math.abs(s) * 0.07));
    }
  });

  it('decodes 0xFF as silence and doubles the byte length', () => {
    const pcm = mulawToPcm16(new Uint8Array(160).fill(0xff));
    expect(pcm.length).toBe(320);
    expect(pcm.readInt16LE(0)).toBe(0);
  });

  it('encodes a PCM buffer sample by sample', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-1000, 2);
    expect(Array.from(pcm16ToMulaw(pcm))).toEqual([encodeMulaw(1000), encodeMulaw(-1000)]);
  });

  it('estimates longer speech for longer lines', () => {
    expect(speechMs('one two three four five six')).toBeGreaterThan(speechMs('hi'));
  });
});

describe('TwiML', () => {
  it('rings trusted callers straight through with no stream', () => {
    const x = directDial('+19715550100');
    expect(x).toContain('<Dial>+19715550100</Dial>');
    expect(x).not.toContain('<Stream');
  });

  it('streams both tracks with the token and puts the caller in a conference', () => {
    const x = screenedCall({ mediaUrl: 'wss://h/media', token: 'tok', callSid: 'CA1', conference: 'scamshield-CA1' });
    expect(x).toContain('track="both_tracks"');
    expect(x).toContain('name="token" value="tok"');
    expect(x).toContain('>scamshield-CA1</Conference>');
  });

  it('escapes agent text', () => {
    expect(sayLine('Hi <Hangup/> & bye')).toContain('Hi &lt;Hangup/&gt; &amp; bye');
  });
});
