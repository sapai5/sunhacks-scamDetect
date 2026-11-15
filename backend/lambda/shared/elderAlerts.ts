// When to alert the elder on their own phone during a screened phone call, and what to say.
// One rule for both channels: text messages (Twilio bridge) and Web Push (push Lambda), so the
// two never disagree. Pure: no AWS or Twilio calls, unit tested in test/elder-alerts.test.ts.
//
// The elder is often looking at the phone call, not the app, so only moments that change what
// they should do get an alert:
//   red         the call turned into a likely scam            (once per call)
//   takeover    the agent took the call; their leg drops       (they might think it failed and call back)
//   scam        the agent confirmed a scam and hung up
//   verified    the caller passed the family question; their phone rings again
//   ended       a yellow or red call ended (green calls end quietly)
import type { AgentStatus, Level } from '../../../contracts/index.js';

/** The parts of a call the rule looks at. */
export interface AlertView {
  level?: Level;
  agentStatus?: AgentStatus;
  ended?: boolean;
  /** The worst level the call reached, for the end-of-call alert. */
  peak?: Level;
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
        title: `${agentName} took over this call`,
        body: `Your call was handed to ${agentName}, so it may have hung up on your side. Don't call this number back.`,
        path: live,
      });
    } else if (b.agentStatus === 'active' && now.agentStatus === 'scam_confirmed') {
      out.push({ kind: 'scam', title: 'It was a scam', body: `${agentName} ended the call. Don't call this number back. Your family has been told.`, path: page });
    } else if (b.agentStatus === 'active' && now.agentStatus === 'verified') {
      out.push({ kind: 'verified', title: 'The caller checked out', body: 'They answered the family question. Your phone will ring so you can keep talking.', path: live });
    }
  }
  const peak = worst(now.peak, now.level, b.peak, b.level);
  // After a confirmed scam the "scam" alert already said it all.
  if (now.ended && !b.ended && peak !== 'green' && now.agentStatus !== 'scam_confirmed') {
    out.push({
      kind: 'ended',
      title: peak === 'red' ? 'You hung up on a likely scam' : 'That call had warning signs',
      body: 'Tap to see what was said.',
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
