// O1 Family contacts. Figma node 15:98.
// Saved to the backend when onboarding finishes; alerts still go to the SNS topic's subscribers (backend/cdk.json).
import { useState } from 'react';
import { Field } from '../../components/Risk';
import { SAMPLE_FAMILY } from '../../lib/fixtures';
import type { Contact } from '../../lib/settings';

export interface O1Props {
  /** Saved contacts (empty on first run, then sample values are shown). */
  initial?: Contact[];
  /** Save the contacts and go to the next step. */
  onNext?: (family: Contact[]) => void;
}

export default function O1FamilyContacts({ initial, onNext }: O1Props) {
  const [family, setFamily] = useState<Contact[]>(initial?.length ? initial : SAMPLE_FAMILY);
  const set = (i: number, patch: Partial<Contact>) => setFamily((f) => f.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <form
      className="screen-form"
      onSubmit={(e) => {
        e.preventDefault();
        onNext?.(family.filter((c) => c.name || c.phone));
      }}
    >
      <h1 className="screen-heading">Who should we text if a call looks like a scam?</h1>
      {family.map((c, i) => (
        <div key={i} className="field-group">
          <Field label="Name" value={c.name} onChange={(name) => set(i, { name })} autoComplete="name" />
          <Field label="Phone" type="tel" value={c.phone} onChange={(phone) => set(i, { phone })} autoComplete="tel" />
        </div>
      ))}
      {family.length < 3 && (
        <button type="button" className="text-button" onClick={() => setFamily((f) => [...f, { name: '', phone: '' }])}>
          Add another person
        </button>
      )}
      {/* Figma: Button (BigButton styles; a real submit so Enter works) */}
      <button type="submit" className="big-button big-button--primary">
        Next
      </button>
    </form>
  );
}

