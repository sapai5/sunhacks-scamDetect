// Connection checks for the Setup screen. The analyze check sends an empty
// transcript, which the Lambda answers without calling Bedrock or SNS.
import type { AppConfig } from '../config/env';
import { errorMessage } from './http';
import type { Services } from './types';

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  ms?: number;
}

async function timed(id: string, label: string, fn: () => Promise<string>): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    return { id, label, ok: true, detail, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { id, label, ok: false, detail: errorMessage(err), ms: Math.round(performance.now() - t0) };
  }
}

export async function runDiagnostics(services: Services, config: AppConfig): Promise<CheckResult[]> {
  const checks: Promise<CheckResult>[] = [
    timed('analyze', 'Scam check (Analyze)', async () => {
      const r = await services.analyze.analyze({
        callId: 'health-check',
        elderId: config.elderId,
        utterances: [],
        prevLevel: 'green',
        calmStreak: 0,
        verification: 'unasked',
      });
      return `Replied with level "${r.level}"`;
    }),
    timed('mic', 'Microphone permission', async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Not available. The page must be served over HTTPS.');
      try {
        const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (p.state === 'denied') throw new Error('Blocked. Allow the microphone in browser settings.');
        return p.state === 'granted' ? 'Allowed' : 'Will ask when you start listening';
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Blocked')) throw err;
        return 'Will ask when you start listening';
      }
    }),
  ];
  if (services.micAvailable) {
    checks.unshift(
      timed('credentials', 'Live transcription access', async () => {
        const c = await services.credentials.getTranscribeCredentials();
        return `Got credentials for ${c.region ?? config.region}`;
      }),
    );
  }
  return Promise.all(checks);
}
