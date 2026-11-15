// Call alerts on this phone (Web Push). The push Lambda sends a notification at the moments in
// backend/lambda/shared/elderAlerts.ts: the call turns red, the agent takes over (the elder's leg
// drops), the agent finishes, a risky call ends. Notifications show over the phone-call screen.
//
// Subscribing goes over the existing push socket (no new URL): ask for the VAPID key, subscribe in the
// browser, send the subscription. iPhone: only from the Home Screen app (iOS 16.4+), never a Safari tab.
// The service worker only registers in production builds, so alerts can't be turned on in `npm run dev`.
import type { PushVapidKeyReply } from '../../../contracts/index.js';
import { isIOS, isStandalone } from './pwa';

const PUSH_URL = import.meta.env.VITE_PUSH_URL;
const ELDER_ID = 'e-01';

export type AlertsState =
  /** This browser can't do Web Push (or no backend configured, or a dev build). */
  | 'unsupported'
  /** iPhone in a Safari tab: add to the Home Screen first. */
  | 'needs-install'
  /** The person said no; only the phone's Settings can undo that. */
  | 'blocked'
  | 'off'
  | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function alertsState(): Promise<AlertsState> {
  if (!PUSH_URL || !import.meta.env.PROD) return 'unsupported';
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Call from a tap: iOS only shows the permission prompt in response to one. */
export async function enableAlerts(): Promise<AlertsState> {
  if (!PUSH_URL || !supported()) return alertsState();
  // First thing in the tap handler, before any other await.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const { vapidKey } = await ask<PushVapidKeyReply>({ action: 'vapidKey' }, (m) => typeof (m as PushVapidKeyReply).vapidKey === 'string');
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidKey) }));
  await ask({ action: 'subscribePush', elderId: ELDER_ID, subscription: sub.toJSON() });
  return 'on';
}

export async function disableAlerts(): Promise<AlertsState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await ask({ action: 'unsubscribePush', elderId: ELDER_ID, subscription: sub.toJSON() }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return alertsState();
}

/** A local notification, so the elder can see what an alert looks like. No server involved. */
export async function showTestAlert(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('This is what an alert looks like', {
    body: 'During a risky call, a notice like this appears. Tap it to open ScamDetermine.',
    tag: 'scamdetermine-test',
    icon: '/icons/icon-192.png',
    data: { url: '/elder/idle' },
  });
}

/**
 * Sends one message on a short-lived push socket. With `until`, waits for the reply that matches
 * (other messages, like call updates, are ignored). Rejects after 8 s.
 */
function ask<T = unknown>(msg: object, until?: (m: unknown) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${PUSH_URL}?elderId=${encodeURIComponent(ELDER_ID)}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('the server did not answer'));
    }, 8_000);
    const done = (value: T) => {
      clearTimeout(timer);
      ws.close();
      resolve(value);
    };
    ws.onopen = () => {
      ws.send(JSON.stringify(msg));
      // No reply expected: give API Gateway a moment to take the message before closing.
      if (!until) setTimeout(() => done(undefined as T), 500);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data as string);
        if (until?.(m)) done(m as T);
      } catch {
        /* not JSON */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('could not reach the server'));
    };
  });
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
