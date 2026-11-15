import type { TranscriptSource } from '../types';

export interface ScriptSourceOptions {
  /** Pause after each finished sentence. */
  lineDelayMs?: number;
  /** Pace of the word-by-word partials, so the demo looks like live captions. */
  wordDelayMs?: number;
}

/** Plays fixed lines as if they were being transcribed. Used for demo calls and tests. */
export function createScriptSource(
  lines: readonly string[],
  { lineDelayMs = 2500, wordDelayMs = 140 }: ScriptSourceOptions = {},
): TranscriptSource {
  return {
    async start(h) {
      let cancelled = false;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          const id = setTimeout(() => {
            timers.delete(id);
            resolve();
          }, ms);
          timers.add(id);
        });

      void (async () => {
        for (const line of lines) {
          const words = line.split(' ');
          for (let i = 1; i < words.length && wordDelayMs > 0; i++) {
            if (cancelled) return;
            h.onPartial(words.slice(0, i).join(' '));
            await wait(wordDelayMs);
          }
          if (cancelled) return;
          h.onFinal(line);
          await wait(lineDelayMs);
        }
        if (!cancelled) h.onEnd?.();
      })();

      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        timers.clear();
      };
    },
  };
}
