// F2 Family call summary. Figma node 15:125.
// No call storage or read endpoint yet: shows the call from this browser (or sample data).
import { Transcript, StageTracker } from '../../components/Dashboard';
import { BigButton, RiskLight } from '../../components/Risk';
import { SNAPSHOT_DONE } from '../../lib/fixtures';
import type { CallSnapshot } from '../../lib/snapshot';
import { stagesOf } from '../../lib/stages';

export interface F2Props {
  call?: CallSnapshot;
  elderName?: string;
  elderPhone?: string;
}

const HEADLINE: Record<string, string> = {
  impersonation: 'impersonation',
  gift_cards: 'gift card request',
  wire_or_crypto: 'wire / crypto request',
  remote_access: 'remote access',
  threats: 'threats',
};

export default function F2CallSummary({ call = SNAPSHOT_DONE, elderName = 'Mom', elderPhone }: F2Props) {
  const risk = call.risk;
  const level = risk?.level ?? 'green';
  const kind = risk?.claimedRelative ? 'grandchild impersonation' : HEADLINE[risk?.tactics[0] ?? ''] ?? 'suspicious call';
  const time = call.startedAt ? new Date(call.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  // Show the lines that pushed risk up the most (Figma shows two).
  const hot = new Set(
    call.history
      .filter((p) => p.newTactics.length > 0)
      .slice(-2)
      .map((p) => p.seq),
  );
  return (
    <div className="screen-family">
      <div className="family-head">
        <RiskLight state={level} size="badge" />
        <span className="family-head__meta">
          {elderName}'s call · {time}
        </span>
      </div>
      <h1 className="screen-heading">{level === 'red' ? `Likely scam: ${kind}` : level === 'yellow' ? `Warning signs: ${kind}` : 'Call looked safe'}</h1>
      <StageTracker hit={stagesOf(risk?.tactics ?? [])} />
      <Transcript utterances={call.transcript.filter((u) => hot.has(u.seq))} history={call.history} startedAt={call.startedAt ?? 0} />
      <BigButton kind="primary" href={elderPhone ? `tel:${elderPhone}` : undefined}>
        Call {elderName} now
      </BigButton>
    </div>
  );
}
