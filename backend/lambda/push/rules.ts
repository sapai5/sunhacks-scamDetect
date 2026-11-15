// Pure validation for what the app sends on the push socket. No AWS calls here so it can be unit tested.
import type { PushAppMessage } from '../../../contracts/index.js';

/** The app's message, or null if it isn't one we accept. */
export function parseAppMessage(body: string | undefined): PushAppMessage | null {
  let m: Record<string, unknown> | null;
  try {
    m = JSON.parse(body ?? '');
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const { callId, action, result } = m;
  if (typeof callId !== 'string' || !callId || callId.length > 64) return null;
  if (action === 'stopAgent') return { action, callId };
  if (action === 'verification' && (result === 'passed' || result === 'failed')) return { action, callId, result };
  return null;
}
