// E11 "What to do now" preview (not in Figma): pick what the elder gave away and see the exact steps
// the end-of-call screen would show. For reviewing the steps for every situation without a call.
// Link straight to a case with /elder/what-next?shared=ssn,money_sent
import { useSearchParams } from 'react-router';
import { EXPOSURES, type Exposure } from '../../../../contracts/index.js';
import { exposureLabel, mergeExposures } from '../../../../contracts/exposures.js';
import { sharedTitle, WhatNext } from '../../components/WhatNext';
import { loadSettings } from '../../lib/settings';
import './callLog.css';

export default function E11WhatNext() {
  const [params, setParams] = useSearchParams();
  const picked = mergeExposures((params.get('shared') ?? 'card_number').split(','));
  const toggle = (e: Exposure) => {
    const next = picked.includes(e) ? picked.filter((p) => p !== e) : [...picked, e];
    setParams({ shared: mergeExposures(next).join(',') }, { replace: true });
  };
  return (
    <div className="screen-log">
      <section className="call-detail__section" aria-label="What the caller got">
        <p className="eyebrow">Preview: what the caller got</p>
        <div className="what-next-picker">
          {EXPOSURES.map((e) => (
            <button key={e} type="button" className="what-next-picker__chip" aria-pressed={picked.includes(e)} onClick={() => toggle(e)}>
              {exposureLabel(e)}
            </button>
          ))}
        </div>
      </section>
      <h1 className="screen-heading">{picked.length ? sharedTitle(picked) : 'Likely scam, nothing given'}</h1>
      {!picked.length && <p className="screen-note">A likely-scam call where the caller got nothing shows only the general steps. Warning-sign calls show none.</p>}
      {/* key: a fresh checklist (no saved ticks) for each combination */}
      <WhatNext key={picked.join(',')} callId={`preview:${picked.join(',')}`} exposures={picked} scam familyPhone={loadSettings().family.find((c) => c.phone)?.phone} />
    </div>
  );
}
