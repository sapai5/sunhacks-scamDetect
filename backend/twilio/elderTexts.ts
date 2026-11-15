// Text messages to the elder's phone during a screened call (see lambda/shared/elderAlerts.ts for
// when). Text banners show over the phone-call screen on any phone, with a link into the app.
//
// Off with TWILIO_TEXTS=0. A failed text is logged and skipped; it never affects the call.
// US carriers may block texts from an unregistered number (Twilio error 30034, A2P 10DLC):
// then Web Push is the channel until the number is registered.
import type twilio from 'twilio';
import type { AgentStatus, Level } from '../../contracts/index.js';
import { elderAlertsFor, smsText, worst, type AlertView } from '../lambda/shared/elderAlerts.js';

export interface ElderTexter {
  /** Record what changed on a call; texts the elder when that's an alert moment. */
  update(callSid: string, change: { level?: Level; agentStatus?: AgentStatus; ended?: boolean }): void;
}

export function elderTexter(opts: {
  tw: ReturnType<typeof twilio>;
  from: string;
  to: string;
  webUrl: string;
  dryRun: boolean;
  log: (callSid: string, msg: string, extra?: object) => void;
}): ElderTexter {
  const enabled = process.env.TWILIO_TEXTS !== '0' && Boolean(opts.to);
  const views = new Map<string, AlertView>();
  const sent = new Map<string, Set<string>>();

  return {
    update(callSid, change) {
      const before = views.get(callSid);
      const now: AlertView = { ...before, ...change };
      now.peak = worst(before?.peak, now.level);
      views.set(callSid, now);
      if (change.ended) setTimeout(() => (views.delete(callSid), sent.delete(callSid)), 10 * 60_000);
      if (!enabled) return;

      const done = sent.get(callSid) ?? new Set<string>();
      sent.set(callSid, done);
      for (const alert of elderAlertsFor(before, now, callSid)) {
        if (done.has(alert.kind)) continue; // once per kind per call
        done.add(alert.kind);
        const body = smsText(alert, opts.webUrl);
        if (opts.dryRun) {
          opts.log(callSid, 'would text elder', { kind: alert.kind, body });
          continue;
        }
        opts.tw.messages
          .create({ to: opts.to, from: opts.from, body })
          .then((m) => opts.log(callSid, 'texted elder', { kind: alert.kind, sid: m.sid }))
          .catch((err: { code?: number; message?: string }) =>
            opts.log(callSid, 'text to elder failed', { kind: alert.kind, code: err.code, error: err.message }),
          );
      }
    },
  };
}
