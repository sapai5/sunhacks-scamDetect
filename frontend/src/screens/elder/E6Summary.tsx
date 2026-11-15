// E6 Call ended summary. Figma node 15:71. Built on the client from the last RiskState.
import type { RiskState } from '../../../../contracts/index.js';
import { BigButton, RiskLight, TextButton } from '../../components/Risk';
import { RISK } from '../../lib/fixtures';

const COPY = {
  red: { title: 'You hung up on a likely scam' },
  yellow: { title: 'That call had warning signs' },
  green: { title: 'That call looked safe' },
} as const;

export interface E6Props {
  /** Last analyze result of the call (null = no result yet). */
  risk?: RiskState | null;
  /** First family contact, for the "Call my family" button. */
  familyPhone?: string;
  onDone?: () => void;
}

export default function E6Summary({ risk = RISK.red, familyPhone, onDone }: E6Props) {
  const level = risk?.level ?? 'green';
  const body = [risk?.reason, risk?.familyAlerted ? 'Your family knows.' : ''].filter(Boolean).join(' ') || 'Nothing suspicious was heard.';
  return (
    <div className="screen-center">
      <RiskLight state={level} size="badge" />
      <h1 className="screen-title">{COPY[level].title}</h1>
      <p className="screen-lede">{body}</p>
      <div className="screen-actions">
        <BigButton kind="primary" href={familyPhone ? `tel:${familyPhone.replace(/[^+\d]/g, '')}` : undefined} onClick={familyPhone ? undefined : onDone}>
          Call my family
        </BigButton>
        {onDone && <TextButton onClick={onDone}>Done</TextButton>}
      </div>
    </div>
  );
}
