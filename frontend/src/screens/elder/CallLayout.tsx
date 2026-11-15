// Shared frame for the in-call screens E1a–E5 (Figma: Call/Header + Risk/Light + Risk/StatusPanel).
import type { ReactNode } from 'react';
import { CallHeader, clock, RiskLight, StatusPanel, type RiskViewState } from '../../components/Risk';
import { SAMPLE_CALLER } from '../../lib/fixtures';

export interface CallLayoutProps {
  state: RiskViewState;
  /** Seconds since the call started. Defaults to the 02:14 shown in Figma. */
  elapsed?: number;
  panelTitle?: string;
  panelBody?: ReactNode;
  /** Buttons / extras under the status panel. */
  children?: ReactNode;
}

export function CallLayout({ state, elapsed = 134, panelTitle, panelBody, children }: CallLayoutProps) {
  return (
    <div className="screen-call">
      <CallHeader number={SAMPLE_CALLER.number} sub={`${SAMPLE_CALLER.label} · ${clock(elapsed)}`} />
      <RiskLight state={state} />
      <StatusPanel state={state} title={panelTitle} body={panelBody} />
      {children}
    </div>
  );
}

/** Props every in-call screen accepts (the live route passes all of them). */
export interface CallScreenProps {
  risk?: import('../../../../contracts/index.js').RiskState | null;
  elapsed?: number;
  /** End the call / hang up: stops listening and goes to the summary. */
  onEnd?: () => void;
  /** E4 only: the elder reports the caller's answer to the family question. */
  onAnswer?: (v: import('../../../../contracts/index.js').Verification) => void;
}
