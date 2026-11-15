// Shared layout for D1–D3 (Figma "ScamDetermine · Live call"): chart + transcript on the
// left, Risk/Light + Stage/Tracker + one context card on the right.
import { EvidenceChart, DashboardTopBar, StageTracker, Transcript, VerdictCard, VerifyCard } from '../../components/Dashboard';
import { clock, RiskLight } from '../../components/Risk';
import type { CallSnapshot } from '../../lib/snapshot';
import { stagesOf } from '../../lib/stages';

export interface LiveDashboardProps {
  call: CallSnapshot;
  /** Which context card to show under the stages: the family question (D2) or Bedrock's verdict (D3). */
  card?: 'auto' | 'verify' | 'verdict';
  /** Wall clock for the elapsed timer (pass Date.now() from a ticking hook for live calls). */
  now?: number;
}

export function LiveDashboard({ call, card = 'auto', now }: LiveDashboardProps) {
  const { risk, view, history, transcript } = call;
  const elapsed = call.startedAt ? ((call.running && now ? now : (transcript.at(-1)?.ts ?? call.startedAt)) - call.startedAt) / 1000 : 0;
  const meta = [`Call #${call.callId.replace(/^c-/, '') || '—'}`, clock(elapsed), `p95 latency ${call.p95Ms ?? '—'} ms`].join(' · ');
  const showVerify = card === 'verify' || (card === 'auto' && call.question);
  const verifyPoint = history.findLast((p) => p.note);
  const verifyDelta = verifyPoint ? verifyPoint.risk - (history[history.indexOf(verifyPoint) - 1]?.risk ?? 0) : undefined;

  return (
    <div className="dash">
      <DashboardTopBar title="ScamDetermine · Live call" meta={meta}>
        <RiskLight state={view} size="badge" />
      </DashboardTopBar>
      <div className="dash-body">
        <div className="dash-col">
          <EvidenceChart history={history} />
          <Transcript utterances={transcript} history={history} startedAt={call.startedAt ?? 0} />
        </div>
        <div className="dash-col">
          <div className="dash-light">
            <RiskLight state={view} />
          </div>
          <StageTracker hit={stagesOf(risk?.tactics ?? [])} />
          {showVerify && call.question ? (
            <VerifyCard question={call.question} verification={call.verification} delta={verifyDelta} />
          ) : (
            (card === 'verdict' || (card === 'auto' && risk?.reason)) && <VerdictCard reason={risk?.reason ?? ''} tactics={risk?.tactics ?? []} level={risk?.level ?? 'green'} />
          )}
        </div>
      </div>
    </div>
  );
}
