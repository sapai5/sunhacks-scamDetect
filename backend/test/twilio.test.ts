import { describe, expect, it } from 'vitest';
import { encodeMulaw, mixPcm16, mulawToPcm16, pcm16ToMulaw, speechMs } from '../twilio/audio.js';
import { openingLine, sonicSystemPrompt } from '../twilio/sonic.js';
import { agentStream, agentTurn, directDial, sayAndHangUp, screenedCall } from '../twilio/twiml.js';

describe('Nova Sonic takeover', () => {
  const persona = { elderName: 'Rose', agentName: 'Mike', agentRelation: 'son', verificationQuestion: 'What did we name the family dog?' };

  it('says the opening line, then connects that leg to the two-way agent stream', () => {
    const xml = agentStream({ opening: openingLine(persona), streamUrl: 'wss://bridge.example/agent', token: 'tok', callSid: 'CA1', leg: 'elder' });
    expect(xml).toMatch(/<Say[^>]*>Hi, this is Mike, Rose's son\..*<\/Say><Connect><Stream url="wss:\/\/bridge\.example\/agent">/);
    expect(xml).toContain('<Parameter name="token" value="tok"/>');
    expect(xml).toContain('<Parameter name="leg" value="elder"/>');
  });

  it('tells the voice model the elder is still on the call and must not be asked the family question', () => {
    const prompt = sonicSystemPrompt(persona, []);
    expect(prompt).toContain('three-way call');
    expect(prompt).toContain('Never ask Rose this question');
  });

  it('gives the voice model the family question and the call so far, and tells it not to end the call', () => {
    const prompt = sonicSystemPrompt(persona, [{ speaker: 'caller', text: 'I need two thousand dollars for bail.' }]);
    expect(prompt).toContain('What did we name the family dog?');
    expect(prompt).toContain('[caller] I need two thousand dollars for bail.');
    expect(prompt).toContain('never say goodbye');
  });
});

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

  it('mixes two voices sample by sample, clips, and treats a missing or short part as silence', () => {
    const a = Buffer.alloc(4);
    a.writeInt16LE(1000, 0);
    a.writeInt16LE(30000, 2);
    const b = Buffer.alloc(4);
    b.writeInt16LE(-400, 0);
    b.writeInt16LE(30000, 2);
    const out = mixPcm16(4, a, b, undefined, Buffer.alloc(0));
    expect([out.readInt16LE(0), out.readInt16LE(2)]).toEqual([600, 32767]);
    expect(mixPcm16(4, undefined).equals(Buffer.alloc(4))).toBe(true);
  });

  it('estimates longer speech for longer lines', () => {
    expect(speechMs('one two three four five six')).toBeGreaterThan(speechMs('hi'));
  });
});

describe('TwiML', () => {
  const base = { idleUrl: 'https://h/idle/CA1/tok', elderPhone: '+19715550100', callerId: '+17375550100' };

  it('rings trusted callers straight through with no stream, from the trial caller ID', () => {
    const x = directDial('+19715550100', '+17375550100');
    expect(x).toContain('<Dial callerId="+17375550100"><Number>+19715550100</Number></Dial>');
    expect(x).not.toContain('<Stream');
  });

  it('streams both tracks with the token, then forwards to the elder (no conference)', () => {
    const x = screenedCall({ mediaUrl: 'wss://h/media', token: 'tok', callSid: 'CA1', elderPhone: '+19715550100', callerId: '+17375550100' });
    expect(x).toContain('track="both_tracks"');
    expect(x).toContain('name="token" value="tok"');
    expect(x.indexOf('<Start>')).toBeLessThan(x.indexOf('<Dial'));
    expect(x).toContain('<Number>+19715550100</Number>');
    expect(x).not.toContain('Conference');
    expect(x).not.toContain('method=');
  });

  it('sends the caller to the after-dial URL when the forwarding ends, so a takeover can keep both on the line', () => {
    const x = screenedCall({ mediaUrl: 'wss://h/media', token: 'tok', callSid: 'CA1', elderPhone: '+19715550100', afterDialUrl: 'https://h/after/CA1/tok' });
    expect(x).toContain('<Dial action="https://h/after/CA1/tok"><Number>+19715550100</Number></Dial>');
    expect(sayAndHangUp('I ended the call.')).toMatch(/<Say[^>]*>I ended the call\.<\/Say><Hangup\/>/);
  });

  it('agent turn: says the line, then waits for the reply and loops back', () => {
    const x = agentTurn({ ...base, text: 'Who is this?', then: 'listen' });
    expect(x).toMatch(/<Say voice="Polly\.[^"]+">Who is this\?<\/Say><Pause length="\d+"\/><Redirect>https:\/\/h\/idle\/CA1\/tok<\/Redirect>/);
  });

  it('agent turn: hands back by ringing the elder, or hangs up', () => {
    expect(agentTurn({ ...base, text: 'Here she is.', then: 'handback' })).toContain('<Number>+19715550100</Number>');
    expect(agentTurn({ ...base, text: 'Goodbye.', then: 'hangup' })).toContain('<Hangup/>');
  });

  it('escapes agent text', () => {
    expect(agentTurn({ ...base, text: 'Hi <Hangup/> & bye', then: 'listen' })).toContain('Hi &lt;Hangup/&gt; &amp; bye');
  });
});
