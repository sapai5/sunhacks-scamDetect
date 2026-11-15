// The agent's voice: the browser's built-in text-to-speech.

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  // Prefer a natural-sounding US voice when the device has one.
  voice =
    voices.find((v) => v.lang === 'en-US' && /natural|enhanced|premium|samantha|aaron|google us/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices[0] ??
    null;
}

/** Call from a tap handler: iOS only allows speech after a user gesture. */
export function unlockSpeech() {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
  speechSynthesis.speak(new SpeechSynthesisUtterance(''));
}

/** Speak a line out loud; resolves when it finishes (or fails). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  speechSynthesis.cancel();
}
