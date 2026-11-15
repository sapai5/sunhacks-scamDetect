// D4 Metrics. Figma node 15:433. Empty in Figma too: fill from the evaluation run.
// No evaluation endpoint yet; pass numbers in as props.
import { DashboardTopBar, MetricTile } from '../../components/Dashboard';

export interface D4Props {
  precision?: string;
  falseAlarmRate?: string;
  medianTimeToRed?: string;
  p95Latency?: string;
}

export default function D4Metrics({ precision, falseAlarmRate, medianTimeToRed, p95Latency }: D4Props) {
  return (
    <div className="dash">
      <DashboardTopBar title="Evaluation on simulated calls from Sol" meta="Call #4821 · 02:14 · p95 latency — ms" />
      <div className="metric-row">
        <MetricTile value={precision} label="Precision" sub="fill from Sol run" />
        <MetricTile value={falseAlarmRate} label="False-alarm rate" sub="should sit near chosen α = 0.02" />
        <MetricTile value={medianTimeToRed} label="Median time to red" sub="utterances / seconds" />
        <MetricTile value={p95Latency} label="p95 latency" sub="at 1,000 concurrent calls" />
      </div>
      <section className="dash-card">
        <h2 className="dash-card__title">Trade-off: sweep α</h2>
        <p className="dash-card__sub">x: false-alarm rate · y: median time to detection. Plot from the Sol evaluation run.</p>
        <div className="dash-card__plot" />
      </section>
    </div>
  );
}
