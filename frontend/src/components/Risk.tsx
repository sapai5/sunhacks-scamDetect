// Elder-facing components. Each maps 1:1 to a Figma component (see the "Figma:" tag).
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ElderView } from '../lib/callState';
import { backspacePhone, caretForDigits, deletePhone, formatUsPhone, keptDigitsBefore } from '../lib/phone';
import './components.css';

export type RiskViewState = ElderView;

export const RISK_LABEL: Record<RiskViewState, string> = {
  listening: 'Listening',
  green: 'Safe',
  yellow: 'Careful',
  verifying: 'Checking',
  red: 'Scam',
};

/** Figma: Risk/Light. hero = 220px light + 28px label; badge = 32px light + 14px label. */
export function RiskLight({
  state,
  size = 'hero',
  label,
  showLabel = true,
  ripple = false,
}: {
  state: RiskViewState;
  size?: 'hero' | 'badge';
  label?: string;
  /** False when the surrounding text already says the state, as on a past-call row. */
  showLabel?: boolean;
  /** Slow rings around the dot. Used on the home "Protected" light. */
  ripple?: boolean;
}) {
  return (
    <div
      className={`risk-light risk-light--${size}${ripple ? ' risk-light--ripple' : ''}`}
      data-state={state}
      role={showLabel ? 'status' : undefined}
      aria-live={showLabel ? 'polite' : undefined}
      aria-hidden={showLabel ? undefined : true}
    >
      <span className="risk-light__lamp" aria-hidden="true">
        <span className="risk-light__core" />
      </span>
      {showLabel && <span className="risk-light__label">{label ?? RISK_LABEL[state]}</span>}
    </div>
  );
}

export const PANEL_COPY: Record<RiskViewState, { title: string; body: string }> = {
  listening: { title: 'Listening to this call', body: "We'll tell you if anything seems wrong." },
  green: { title: 'This call looks safe', body: 'Keep talking as usual.' },
  yellow: { title: 'Be careful', body: "Don't share money, gift cards or codes yet." },
  verifying: { title: "Checking who's calling", body: 'Ask the caller a family question.' },
  red: { title: 'This is likely a scam', body: 'Hang up your phone now. Your family has been told.' },
};

/** Figma: Risk/StatusPanel */
export function StatusPanel({ state, title, body, children }: { state: RiskViewState; title?: string; body?: ReactNode; children?: ReactNode }) {
  const copy = PANEL_COPY[state];
  return (
    <div className="status-panel" data-state={state}>
      <p className="status-panel__title">{title ?? copy.title}</p>
      <p className="status-panel__body">{body ?? copy.body}</p>
      {children}
    </div>
  );
}

/** Figma: Button. hangup = danger, primary = verify blue, secondary = outline (not in Figma: used for extra demo actions). */
export function BigButton({
  kind,
  children,
  onClick,
  href,
  disabled,
}: {
  kind: 'hangup' | 'primary' | 'secondary';
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const cls = `big-button big-button--${kind}`;
  if (href)
    return (
      <a className={cls} href={href}>
        {children}
      </a>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Small text button for secondary actions ("End call", "Done"). Not a Figma component. */
export function TextButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="text-button" onClick={onClick}>
      {children}
    </button>
  );
}

/** Figma: Call/Header */
export function CallHeader({ number, sub }: { number: string; sub: string }) {
  return (
    <div className="call-header">
      <p className="call-header__number">{number}</p>
      <p className="call-header__sub">{sub}</p>
    </div>
  );
}

/** Figma: "Polly speaking" pill on E4. */
export function SpeakingPill({ children }: { children: ReactNode }) {
  return (
    <p className="speaking-pill">
      <span className="speaking-pill__dot" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Figma: field (label + input) on the onboarding screens. */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'tel';
  placeholder?: string;
  autoComplete?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = type === 'tel' ? formatUsPhone(value) : value;
  // Put the caret back after a format. React would otherwise leave it at the end.
  useLayoutEffect(() => {
    const el = input.current;
    if (caret.current == null || !el || document.activeElement !== el) return;
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [shown]);

  const commit = (next: string, pos: number, el?: HTMLInputElement) => {
    caret.current = pos;
    if (next !== shown) onChange(next);
    else if (el) {
      // Already 10 digits: drop the extra keystroke and leave the caret where it was.
      el.value = shown;
      el.setSelectionRange(pos, pos);
      caret.current = null;
    }
  };

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        ref={input}
        className="field__input"
        type={type}
        inputMode={type === 'tel' ? 'tel' : undefined}
        value={shown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCorrect={type === 'tel' ? 'off' : undefined}
        spellCheck={type === 'tel' ? false : undefined}
        onKeyDown={(e) => {
          if (type !== 'tel' || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
          const el = e.currentTarget;
          const start = el.selectionStart ?? 0;
          if (start !== (el.selectionEnd ?? 0)) return;
          const edit = e.key === 'Backspace' ? backspacePhone(shown, start) : deletePhone(shown, start);
          if (!edit) return;
          e.preventDefault();
          commit(edit.value, edit.caret, el);
        }}
        onChange={(e) => {
          if (type !== 'tel') {
            onChange(e.target.value);
            return;
          }
          const next = formatUsPhone(e.target.value);
          const pos = caretForDigits(next, keptDigitsBefore(e.target.value, e.target.selectionStart ?? e.target.value.length));
          commit(next, pos, e.target);
        }}
      />
    </label>
  );
}

/** Figma: SMS/Bubble (F1) */
export function SmsBubble({ children }: { children: ReactNode }) {
  return <div className="sms-bubble">{children}</div>;
}

/** mm:ss from seconds. */
export const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
