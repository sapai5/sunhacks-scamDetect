// When to alert the elder on their own phone during a screened phone call, and what to say.
// One rule for both channels: text messages (Twilio bridge) and Web Push (push Lambda), so the
// two never disagree. Pure: no AWS or Twilio calls, unit tested in test/elder-alerts.test.ts.
//
// The elder is often looking at the phone call, not the app, so only moments that change what
// they should do get an alert:
//   red         the call turned into a likely scam            (once per call)
//   takeover    the agent joined the call; they stay on the line and hear it
//   scam        the agent confirmed a scam and hung up
//   verified    the caller passed the family question; the agent steps back
//   ended       a yellow or red call ended (green calls end quietly)
import type { AgentStatus, Exposure, Level } from '../../../contracts/index.js';
import { exposureSentence } from '../../../contracts/exposures.js';

/** The parts of a call the rule looks at. */
export interface AlertView {
  level?: Level;
  agentStatus?: AgentStatus;
  ended?: boolean;
  /** The worst level the call reached, for the end-of-call alert. */
  peak?: Level;
  /** What the elder handed over: the end-of-call alert points them to the steps to take. */
  exposures?: Exposure[];
}

export type ElderAlertKind = 'red' | 'takeover' | 'scam' | 'verified' | 'ended';

export interface ElderAlert {
  kind: ElderAlertKind;
  title: string;
  body: string;
  /** App path to open: the live call, or the finished call's page. */
  path: string;
}

const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

/** Alerts for the change from `before` to `now`, in the order they happened. */
export function elderAlertsFor(before: AlertView | undefined, now: AlertView, callId: string, agentName = 'Mike'): ElderAlert[] {
  const b = before ?? {};
  const out: ElderAlert[] = [];
  const live = '/elder/live';
  const page = `/elder/call?id=${encodeURIComponent(callId)}`;

  if (now.level === 'red' && b.level !== 'red' && (b.peak ?? b.level) !== 'red' && now.agentStatus !== 'active') {
    out.push({ kind: 'red', title: 'This call may be a scam', body: "Don't send money, gift cards or codes. Open ScamDetermine to see why.", path: live });
  }
  if (now.agentStatus !== b.agentStatus) {
    if (now.agentStatus === 'active') {
      out.push({
        kind: 'takeover',
        title: `${agentName} joined this call`,
        body: `Stay on the line. ${agentName} is asking the caller a few questions. Don't send money, gift cards or codes.`,
        path: live,
      });
    } else if (b.agentStatus === 'active' && now.agentStatus === 'scam_confirmed') {
      out.push({ kind: 'scam', title: 'It was a scam', body: `${agentName} ended the call. Don't call this number back. Your family has been told.`, path: page });
    } else if (b.agentStatus === 'active' && now.agentStatus === 'verified') {
      out.push({ kind: 'verified', title: 'The caller checked out', body: 'They answered the family question. You can keep talking.', path: live });
    }
  }
  const peak = worst(now.peak, now.level, b.peak, b.level);
  const shared = now.exposures?.length ? exposureSentence(now.exposures) : '';
  // After a confirmed scam the "scam" alert already said it all, unless something was handed over first.
  if (now.ended && !b.ended && peak !== 'green' && (now.agentStatus !== 'scam_confirmed' || shared)) {
    out.push({
      kind: 'ended',
      title: shared ? `You may have given the caller ${shared}` : peak === 'red' ? 'You hung up on a likely scam' : 'That call had warning signs',
      body: shared ? 'Tap for the steps to take now. Your family can help.' : 'Tap to see what was said.',
      path: page,
    });
  }
  return out;
}

export function worst(...levels: (Level | undefined)[]): Level {
  return levels.reduce<Level>((a, l) => (l && RANK[l] > RANK[a] ? l : a), 'green');
}

/** One text message: title, body and the app link, kept short for a lock-screen banner. */
export function smsText(a: ElderAlert, webUrl: string): string {
  return `ScamDetermine: ${a.title}. ${a.body} ${webUrl.replace(/\/+$/, '')}${a.path}`;
}
