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
  /** Submit button text ("Save" when edited from Settings). */
  submitLabel?: string;
}

export default function O1FamilyContacts({ initial, onNext, submitLabel = 'Next' }: O1Props) {
  const [family, setFamily] = useState<Contact[]>(initial?.length ? initial : SAMPLE_FAMILY);
  const [index, setIndex] = useState(0);
  const current = family[index] ?? family[0] ?? { name: '', phone: '' };
  const set = (patch: Partial<Contact>) => setFamily((list) => list.map((c, j) => (j === index ? { ...c, ...patch } : c)));

  return (
    <form
      className="screen-form"
      onSubmit={(e) => {
        e.preventDefault();
        onNext?.(family.filter((c) => c.name || c.phone));
      }}
    >
      <h1 className="screen-heading">Who should we text if a call looks like a scam?</h1>
      {family.length > 1 && (
        <div className="contact-switch">
          <button type="button" className="contact-switch__btn" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            Previous
          </button>
          <p className="contact-switch__count">
            Person {index + 1} of {family.length}
          </p>
          <button type="button" className="contact-switch__btn" disabled={index === family.length - 1} onClick={() => setIndex((i) => i + 1)}>
            Next
          </button>
        </div>
      )}
      <div className="field-group">
        <Field label="Name" value={current.name} onChange={(name) => set({ name })} autoComplete="name" />
        <Field key={index} label="Phone" type="tel" value={current.phone} onChange={(phone) => set({ phone })} autoComplete="tel" placeholder="(480) 555-0193" />
      </div>
      {family.length < 3 && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setFamily((list) => [...list, { name: '', phone: '' }]);
            setIndex(family.length);
          }}
        >
          Add another person
        </button>
      )}
      {/* Figma: Button (BigButton styles; a real submit so Enter works) */}
      <button type="submit" className="big-button big-button--primary">
        {submitLabel}
      </button>
    </form>
  );
}

