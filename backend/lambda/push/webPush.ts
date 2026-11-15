// Web Push to the elder's phone (notifications that show over the phone-call screen).
// VAPID keys live in SSM Parameter Store as a SecureString (VAPID_PARAM). The first request makes
// them, so there is no secret in the repo and nothing to set up by hand. Rotating the keys
// (deleting the parameter) means each phone turns alerts on again.
import { ParameterAlreadyExists, ParameterNotFound, GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import webpush from 'web-push';
import type { WebPushSubscription } from '../../../contracts/index.js';
import type { ElderAlert } from '../shared/elderAlerts.js';

const ssm = new SSMClient({});
const PARAM = process.env.VAPID_PARAM ?? '/scamshield/vapid';
/** VAPID "subject": who runs this sender. The web app's https URL (Apple and Mozilla require mailto: or https:). */
const SUBJECT = process.env.WEB_URL || 'https://example.com';

interface Vapid {
  publicKey: string;
  privateKey: string;
}
let cached: Promise<Vapid> | undefined;

export function vapidKeys(): Promise<Vapid> {
  cached ??= loadOrCreate().catch((err) => {
    cached = undefined; // retry on the next request
    throw err;
  });
  return cached;
}

async function loadOrCreate(): Promise<Vapid> {
  try {
    const { Parameter } = await ssm.send(new GetParameterCommand({ Name: PARAM, WithDecryption: true }));
    return JSON.parse(Parameter!.Value!) as Vapid;
  } catch (err) {
    if (!(err instanceof ParameterNotFound)) throw err;
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    await ssm.send(new PutParameterCommand({ Name: PARAM, Type: 'SecureString', Value: JSON.stringify(keys), Overwrite: false }));
    return keys;
  } catch (err) {
    // Another invocation created them first: use theirs.
    if (!(err instanceof ParameterAlreadyExists)) throw err;
    const { Parameter } = await ssm.send(new GetParameterCommand({ Name: PARAM, WithDecryption: true }));
    return JSON.parse(Parameter!.Value!) as Vapid;
  }
}

/** What the service worker gets (sw.ts shows it). */
export interface NotificationPayload {
  title: string;
  body: string;
  /** App path to open on tap. */
  url: string;
  /** Same tag = replaces the earlier notification for this call instead of stacking. */
  tag: string;
  kind: ElderAlert['kind'];
}

/**
 * Sends one notification. Returns 'gone' when the browser dropped the subscription (404/410),
 * so the caller removes it; 'failed' for anything else (logged, kept).
 */
export async function sendNotification(sub: WebPushSubscription, payload: NotificationPayload): Promise<'sent' | 'gone' | 'failed'> {
  const { publicKey, privateKey } = await vapidKeys();
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: { subject: SUBJECT, publicKey, privateKey },
      TTL: 120, // an alert about a call is useless a few minutes later
      urgency: 'high',
      topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32), // replaces an undelivered one for the same call
    });
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    console.error('web push failed', status, (err as Error).message);
    return 'failed';
  }
}
