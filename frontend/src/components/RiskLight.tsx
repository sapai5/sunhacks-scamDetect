import type { Level } from '@contracts';
import { LEVEL_LABEL } from '../features/call/labels';
import s from './RiskLight.module.css';

interface Props {
  level: Level;
  size?: 'lg' | 'sm';
  /** Grey "not listening" state. */
  idle?: boolean;
  label?: string;
}

export function RiskLight({ level, size = 'lg', idle = false, label }: Props) {
  const text = label ?? (idle ? '—' : LEVEL_LABEL[level]);
  return (
    <div className={`${s.light} ${s[size]} ${idle ? s.idle : s[level]}`} role="status" aria-live="polite" aria-label={`Risk: ${text}`}>
      <span>{text}</span>
    </div>
  );
}
