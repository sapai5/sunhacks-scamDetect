// Pure validation for what the app sends on the push socket. No AWS calls here so it can be unit tested.
import { createHash } from 'node:crypto';
import type { PushAppMessage, WebPushSubscription } from '../../../contracts/index.js';

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** The app's message, or null if it isn't one we accept. */
export function parseAppMessage(body: string | undefined): PushAppMessage | null {
  let m: Record<string, unknown> | null;
  try {
    m = JSON.parse(body ?? '');
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const { callId, action, result, elderId, subscription } = m;
  if (action === 'vapidKey') return { action };
  if (action === 'current') return isId(elderId) ? { action, elderId } : null;
  if (action === 'subscribePush' || action === 'unsubscribePush') {
    const sub = parseSubscription(subscription);
    return isId(elderId) && sub ? { action, elderId, subscription: sub } : null;
  }
  if (!isId(callId)) return null;
  if (action === 'stopAgent') return { action, callId };
  if (action === 'verification' && (result === 'passed' || result === 'failed')) return { action, callId, result };
  return null;
}

/** Push services are https endpoints run by the browser vendors; anything else could make us call arbitrary URLs. */
export function parseSubscription(v: unknown): WebPushSubscription | null {
  if (!v || typeof v !== 'object') return null;
  const { endpoint, keys } = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const b64url = /^[A-Za-z0-9_-]{8,200}$/;
  if (typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string' || !b64url.test(keys.p256dh) || !b64url.test(keys.auth)) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Short stable key for a subscription, used as its name in the Elders item's `webPush` map. */
export function subscriptionKey(endpoint: string): string {
  return `s${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;
}
