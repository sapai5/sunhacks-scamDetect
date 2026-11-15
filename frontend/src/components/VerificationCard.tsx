import { Button } from './Button';
import s from './VerificationCard.module.css';

interface Props {
  question: string;
  onAnswer(result: 'passed' | 'failed'): void;
}

/** Shown when the caller claims to be family: a question only the real relative knows. */
export function VerificationCard({ question, onAnswer }: Props) {
  return (
    <section className={s.card} aria-labelledby="verify-q">
      <p className={s.ask}>Ask the caller:</p>
      <p id="verify-q" className={s.question}>
        {question}
      </p>
      <div className="row">
        <Button variant="success" onClick={() => onAnswer('passed')}>
          They got it right
        </Button>
        <Button variant="danger" onClick={() => onAnswer('failed')}>
          Wrong answer
        </Button>
      </div>
    </section>
  );
}
