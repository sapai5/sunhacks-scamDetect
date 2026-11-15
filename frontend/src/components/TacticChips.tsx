import type { Tactic } from '@contracts';
import { TACTIC_LABEL } from '../features/call/labels';
import s from './TacticChips.module.css';

export function TacticChips({ tactics }: { tactics: readonly Tactic[] }) {
  if (tactics.length === 0) return null;
  return (
    <ul className={s.chips} aria-label="Warning signs">
      {tactics.map((t) => (
        <li key={t} className={s.chip}>
          {TACTIC_LABEL[t]}
        </li>
      ))}
    </ul>
  );
}
