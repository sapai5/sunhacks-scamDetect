// E6 Call ended summary. Figma node 15:71. Built on the client from the last RiskState.
// When the elder handed something over (card number, SSN, a code...), it leads with the steps to take now.
import type { Level, RiskState } from '../../../../contracts/index.js';
import { mergeExposures } from '../../../../contracts/exposures.js';
import { Link } from 'react-router';
import { BigButton, RiskLight, TextButton } from '../../components/Risk';
import { SharedPicker, sharedTitle, useWhatWasShared, WhatNext } from '../../components/WhatNext';
import { getCall } from '../../lib/callLog';
import { RISK } from '../../lib/fixtures';
import './callLog.css';

const COPY = {
  red: { title: 'You hung up on a likely scam' },
  yellow: { title: 'That call had warning signs' },
  green: { title: 'That call looked safe' },
} as const;

const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };
const worse = (a: Level | undefined, b: Level): Level => (a && RANK[a] > RANK[b] ? a : b);

export interface E6Props {
  /** Last analyze result of the call (null = no result yet). */
  risk?: RiskState | null;
  /** First family contact, for the "Call my family" button. */
  familyPhone?: string;
  onDone?: () => void;
}

export default function E6Summary({ risk = RISK.red, familyPhone, onDone }: E6Props) {
  const level = risk?.level ?? 'green';
  // The call log has the worst level and everything handed over; the last result alone may have less.
  const logged = risk?.callId ? getCall(risk.callId) : undefined;
  const peak = worse(logged?.peak, level);
  const shared = useWhatWasShared(risk?.callId ?? '', peak === 'green' ? [] : mergeExposures(risk?.exposures, logged?.exposures));
  const exposures = shared.exposures;
  const gave = peak !== 'green' && exposures.length > 0;
  const body = gave
    ? `Start at the top. Each step only takes a phone call.${risk?.familyAlerted ? ' Your family knows.' : ''}`
    : [risk?.reason, risk?.familyAlerted ? 'Your family knows.' : ''].filter(Boolean).join(' ') || 'Nothing suspicious was heard.';
  return (
    <div className="screen-center">
      <RiskLight state={peak} size="badge" />
      <h1 className="screen-title">{gave ? sharedTitle(exposures) : COPY[peak].title}</h1>
      <p className="screen-lede">{body}</p>
      {peak !== 'green' && (
        <>
          <SharedPicker shared={shared} />
          <WhatNext callId={risk?.callId ?? ''} exposures={exposures} scam={peak === 'red'} familyPhone={familyPhone} />
        </>
      )}
      <div className="screen-actions">
        <BigButton kind="primary" href={familyPhone ? `tel:${familyPhone.replace(/[^+\d]/g, '')}` : undefined} onClick={familyPhone ? undefined : onDone}>
          Call my family
        </BigButton>
        {risk?.callId && (
          <Link className="call-log-link" to={`/elder/call?id=${encodeURIComponent(risk.callId)}`}>
            See what was said
          </Link>
        )}
        {onDone && <TextButton onClick={onDone}>Done</TextButton>}
      </div>
    </div>
  );
}
