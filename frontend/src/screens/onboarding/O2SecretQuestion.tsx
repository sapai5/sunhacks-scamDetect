// O2 Secret question. Figma node 15:110.
// The live backend asks verificationQuestion from backend/cdk.json (no settings endpoint yet).
import { useState } from 'react';
import { Field } from '../../components/Risk';

export interface O2Props {
  initial?: { question: string; answer: string };
  onNext?: (v: { question: string; answer: string }) => void;
}

export default function O2SecretQuestion({ initial, onNext }: O2Props) {
  const [question, setQuestion] = useState(initial?.question || "Grandpa's old dog's name?");
  const [answer, setAnswer] = useState(initial?.answer || 'Biscuit');
  return (
    <form
      className="screen-form"
      onSubmit={(e) => {
        e.preventDefault();
        onNext?.({ question, answer });
      }}
    >
      <h1 className="screen-heading">Pick a question only family can answer</h1>
      <Field label="Question" value={question} onChange={setQuestion} />
      <Field label="Answer" value={answer} onChange={setAnswer} />
      <button type="submit" className="big-button big-button--primary">
        Next
      </button>
    </form>
  );
}
