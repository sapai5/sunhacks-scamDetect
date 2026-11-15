import s from './StatusDot.module.css';

export function StatusDot({ tone }: { tone: 'green' | 'yellow' | 'red' | 'off' }) {
  return <span className={`${s.dot} ${s[tone]}`} aria-hidden />;
}
