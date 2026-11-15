import type { ReactNode } from 'react';
import s from './TopBar.module.css';

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className={s.bar}>
      {onBack && (
        <button className={s.back} onClick={onBack} aria-label="Back">
          ‹ Back
        </button>
      )}
      <h1 className={s.title}>{title}</h1>
      {right}
    </header>
  );
}
