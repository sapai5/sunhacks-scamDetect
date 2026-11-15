import { useEffect, useRef } from 'react';
import type { Utterance } from '@contracts';
import s from './Transcript.module.css';

interface Props {
  utterances: readonly Utterance[];
  partial?: string;
  defaultOpen?: boolean;
}

export function Transcript({ utterances, partial = '', defaultOpen = false }: Props) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [utterances.length, partial]);

  return (
    <details className={s.details} open={defaultOpen}>
      <summary className={s.summary}>What we heard ({utterances.length})</summary>
      {utterances.length === 0 && !partial ? (
        <p className={s.empty}>Nothing yet.</p>
      ) : (
        <ol className={s.list}>
          {utterances.map((u) => (
            <li key={u.seq}>{u.text}</li>
          ))}
          {partial && <li className={s.partial}>{partial}</li>}
          <li ref={endRef} aria-hidden style={{ listStyle: 'none', height: 0 }} />
        </ol>
      )}
    </details>
  );
}
