// Elder-facing components. Each maps 1:1 to a Figma component (see the "Figma:" tag).
import type { ReactNode } from 'react';
import type { ElderView } from '../lib/callState';
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
export function RiskLight({ state, size = 'hero', label }: { state: RiskViewState; size?: 'hero' | 'badge'; label?: string }) {
  return (
    <div className={`risk-light risk-light--${size}`} data-state={state} role="status" aria-live="polite">
      <span className="risk-light__lamp" aria-hidden="true">
        <span className="risk-light__core" />
      </span>
      <span className="risk-light__label">{label ?? RISK_LABEL[state]}</span>
    </div>
  );
}

export const PANEL_COPY: Record<RiskViewState, { title: string; body: string }> = {
  listening: { title: 'Listening to this call', body: "We'll tell you if anything seems wrong." },
  green: { title: 'This call looks safe', body: 'Keep talking as usual.' },
  yellow: { title: 'Be careful', body: "Don't share money, gift cards or codes yet." },
  verifying: { title: "Checking who's calling", body: 'Ask the caller a family question.' },
  red: { title: 'This is likely a scam', body: 'Hang up now. Your family has been told.' },
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
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
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
