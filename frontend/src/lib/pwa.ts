// Mobile PWA helpers: service worker, standalone detection, install prompt, wake lock, status bar colour.
import { useEffect, useState } from 'react';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True when launched from the Home Screen (not a browser tab). */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Production only: the dev server serves modules that shouldn't be cached. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('service worker registration failed', err));
  });
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captured at module load: Chrome fires it once, possibly before any component mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((l) => l());
});

/**
 * How this device can install the app:
 * - 'prompt': Android/desktop Chrome, call install() from a tap
 * - 'ios': Safari, show "Share → Add to Home Screen" instructions (no API on iOS)
 * - null: already installed, or not installable
 */
export function useInstall(): { mode: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const mode = isStandalone() ? null : deferredPrompt ? 'prompt' : isIOS() ? 'ios' : null;
  return {
    mode,
    install: async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      force((n) => n + 1);
    },
  };
}

/**
 * Keeps the screen on while `active`. A locked screen stops the mic (and iOS suspends the app),
 * so this matters for the whole call. The lock drops when the app is hidden; re-acquire on return.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock?.release();
      } catch {
        /* low battery mode, or not allowed: the screen may dim */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}

/** Tints the browser / Android status bar (e.g. red during a scam call). Restores white on unmount. */
export function useThemeColor(color: string) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const prev = meta.content;
    meta.content = color;
    return () => {
      meta.content = prev;
    };
  }, [color]);
}

/** Whether the page is visible. iOS suspends the mic when the app goes to the background. */
export function useVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}
