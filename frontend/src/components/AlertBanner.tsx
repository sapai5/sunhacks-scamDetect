import type { ReactNode } from 'react';
import s from './AlertBanner.module.css';

export function AlertBanner({ tone = 'info', children }: { tone?: 'info' | 'danger'; children: ReactNode }) {
  return (
    <p className={`${s.banner} ${s[tone]}`} role={tone === 'danger' ? 'alert' : undefined}>
      {children}
    </p>
  );
}
