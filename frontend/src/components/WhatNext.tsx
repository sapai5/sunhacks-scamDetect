// "What to do now" after a scam call. The steps come from contracts/exposures.ts (hand-written, never
// from the model), for what the elder handed over: what was heard on the call, plus anything the elder
// says they gave (the detector can miss it, or they bought the cards after hanging up).
// Ticked steps and the elder's answers are kept on this phone per call.
import { useEffect, useId, useRef, useState } from 'react';
import { EXPOSURES, type Exposure } from '../../../contracts/index.js';
import { exposureLabel, exposureSentence, mergeExposures, whatNext } from '../../../contracts/exposures.js';
import './whatNext.css';

const DONE_KEY = 'scamdetermine.whatNext';
const SHARED_KEY = 'scamdetermine.whatNextShared';

function load(key: string, callId: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string[]>;
    return Array.isArray(all[callId]) ? all[callId] : [];
  } catch {
    return [];
  }
}

function save(key: string, callId: string, list: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string[]>;
    all[callId] = list;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* blocked storage: just not remembered */
  }
}

/** The headline for a call where something was handed over: "You may have given the caller your card number". */
export function sharedTitle(exposures: readonly Exposure[]): string {
  return `You may have given the caller ${exposureSentence(exposures)}`;
}

/**
 * What was handed over on a call: `detected` (heard on the call) plus what the elder taps in the picker.
 * Call it before any early return (it's a hook).
 */
export function useWhatWasShared(callId: string, detected: readonly Exposure[]) {
  const [reported, setReported] = useState(() => mergeExposures(load(SHARED_KEY, callId)));
  const toggle = (e: Exposure) => {
    const next = reported.includes(e) ? reported.filter((r) => r !== e) : mergeExposures([...reported, e]);
    setReported(next);
    save(SHARED_KEY, callId, next);
  };
  return { exposures: mergeExposures(detected, reported), detected, toggle };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the pill says: "Nothing", "Gift cards, money", "Your card number +2 more". */
function pillText(list: readonly Exposure[]): string {
  if (!list.length) return 'Nothing';
  if (list.length <= 2) return capital(list.map((e) => exposureLabel(e)).join(', '));
  return `${capital(exposureLabel(list[0]))} +${list.length - 1} more`;
}

/**
 * "Did you give the caller anything?" as one pill that opens a multi-select list. What was heard on
 * the call is already ticked and can't be unticked.
 */
export function SharedPicker({ shared }: { shared: ReturnType<typeof useWhatWasShared> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const qId = useId();
  const panelId = useId();
  // Close on a tap outside or Escape (focus back on the pill).
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      pill.current?.focus();
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <section className="what-next-ask">
      <p className="what-next-ask__q" id={qId}>
        Did you give the caller anything?
      </p>
      <div className="what-next-dropdown" ref={box}>
        <button
          ref={pill}
          type="button"
          className="what-next-dropdown__pill"
          aria-labelledby={`${qId} ${panelId}-pill`}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          data-picked={shared.exposures.length > 0}
          onClick={() => setOpen((o) => !o)}
        >
          <span id={`${panelId}-pill`}>{pillText(shared.exposures)}</span>
          <span className="what-next-dropdown__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <div className="what-next-dropdown__panel" id={panelId} role="group" aria-labelledby={qId}>
            <p className="what-next-dropdown__hint">Tick all that apply</p>
            {EXPOSURES.map((e) => {
              const heard = shared.detected.includes(e);
              return (
                <label key={e} className="what-next-dropdown__option" data-heard={heard}>
                  <input type="checkbox" checked={shared.exposures.includes(e)} disabled={heard} onChange={() => shared.toggle(e)} />
                  <span>
                    {capital(exposureLabel(e))}
                    {heard && <small>Heard on the call</small>}
                  </span>
                </label>
              );
            })}
            <button type="button" className="what-next-dropdown__done" onClick={() => (setOpen(false), pill.current?.focus())}>
              Done
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export interface WhatNextProps {
  callId: string;
  exposures: readonly Exposure[];
  familyPhone?: string;
  /** A likely scam: show the general steps even when nothing was handed over. */
  scam?: boolean;
  /** Family view: shows the steps without tick boxes. */
  readOnly?: boolean;
}

export function WhatNext({ callId, exposures, familyPhone, scam, readOnly }: WhatNextProps) {
  const steps = whatNext(exposures, { familyPhone, scam });
  const [done, setDone] = useState(() => load(DONE_KEY, callId));
  if (!steps.length) return null;
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    save(DONE_KEY, callId, next);
  };
  const left = steps.filter((s) => !done.includes(s.id)).length;
  return (
    <section className="what-next" aria-label="What to do now">
      <div className="what-next__head">
        <p className="eyebrow">What to do now</p>
        {!readOnly && <p className="what-next__count">{left ? `${left} of ${steps.length} left` : 'All done'}</p>}
      </div>
      <ol className="what-next__list">
        {steps.map((s, i) => {
          const isDone = !readOnly && done.includes(s.id);
          return (
            <li key={s.id} className={`what-next__step${isDone ? ' what-next__step--done' : ''}${exposures.length ? '' : ' what-next__step--calm'}`}>
              {readOnly ? (
                <span className="what-next__num" aria-hidden="true">
                  {i + 1}
                </span>
              ) : (
                <button
                  type="button"
                  className="what-next__check"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`${s.title}: ${isDone ? 'done' : 'not done'}`}
                  onClick={() => toggle(s.id)}
                >
                  {isDone ? '✓' : i + 1}
                </button>
              )}
              <div className="what-next__body">
                <p className="what-next__title">{s.title}</p>
                <p className="what-next__detail">{s.detail}</p>
                {(s.call || s.link) && (
                  <div className="what-next__actions">
                    {s.call && (
                      <a className="what-next__action what-next__action--call" href={`tel:${s.call.tel}`}>
                        {s.call.label}
                      </a>
                    )}
                    {s.link && (
                      <a className="what-next__action" href={s.link.href} target="_blank" rel="noreferrer">
                        {s.link.label}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
