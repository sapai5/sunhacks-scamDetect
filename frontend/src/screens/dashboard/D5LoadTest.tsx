// D5 Load test. Figma node 15:458. Sample pattern, like Figma.
// To make it live, pass `levels` (one per simulated call) from a counts source (Figma notes DynamoDB; not built yet).
import type { Level } from '../../../../contracts/index.js';
import { DashboardTopBar } from '../../components/Dashboard';

function samplePattern(n: number): Level[] {
  // Deterministic pseudo-random: ~85% green, ~11% yellow, ~4% red.
  let seed = 4821;
  return Array.from({ length: n }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const r = seed / 0x7fffffff;
    return r < 0.04 ? 'red' : r < 0.15 ? 'yellow' : 'green';
  });
}

export default function D5LoadTest({ levels = samplePattern(1000) }: { levels?: Level[] }) {
  return (
    <div className="dash">
      <DashboardTopBar title={`Load test · ${levels.length.toLocaleString()} simulated calls`} meta="Call #4821 · 02:14 · p95 latency — ms" />
      <p className="dash-card__sub">Sample pattern; bind to live counts from DynamoDB</p>
      <div className="call-grid" role="img" aria-label={`${levels.filter((l) => l === 'red').length} red, ${levels.filter((l) => l === 'yellow').length} yellow`}>
        {levels.map((l, i) => (
          <span key={i} className="call-grid__dot" data-level={l} />
        ))}
      </div>
    </div>
  );
}
