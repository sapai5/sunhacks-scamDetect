import s from './RiskMeter.module.css';

export function RiskMeter({ risk }: { risk: number }) {
  const pct = Math.max(0, Math.min(100, risk));
  return (
    <div className={s.track} role="meter" aria-label="Scam risk" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className={s.fill} style={{ width: `${pct}%` }} />
    </div>
  );
}
