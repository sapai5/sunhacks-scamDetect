// E8 Past calls (not in Figma yet). Every call this phone showed, newest first; tap one for its transcript.
import { useState } from 'react';
import { Link } from 'react-router';
import { RiskLight, TextButton } from '../../components/Risk';
import { clearCallLog, loadCallLog, type CallLogEntry } from '../../lib/callLog';
import './callLog.css';

export const HEADLINE = { red: 'Likely scam', yellow: 'Warning signs', green: 'Looked safe' } as const;

export const when = (t: number) =>
  new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const duration = (c: CallLogEntry) => {
  const sec = Math.max(0, Math.round((c.updatedAt - c.startedAt) / 1000));
  return sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`;
};

export default function E8CallLog({ entries }: { entries?: CallLogEntry[] }) {
  const [calls, setCalls] = useState(() => entries ?? loadCallLog());
  return (
    <div className="screen-log">
      <h1 className="screen-heading">Past calls</h1>
      {calls.length === 0 ? (
        <p className="screen-lede">No calls yet. Calls ScamDetermine listens to show up here, with what was said.</p>
      ) : (
        <ul className="call-log">
          {calls.map((c) => (
            <li key={c.callId}>
              <Link className="call-log__row" to={`/elder/call?id=${encodeURIComponent(c.callId)}`}>
                <RiskLight state={c.peak} size="badge" showLabel={false} />
                <span className="call-log__text">
                  <span className="call-log__title">
                    {HEADLINE[c.peak]}
                    {c.running && <span className="call-log__live"> · now</span>}
                  </span>
                  <span className="call-log__meta">
                    {when(c.startedAt)} · {duration(c)}
                    {c.familyAlerted && ' · family told'}
                  </span>
                </span>
                <span className="call-log__chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="screen-actions">
        {calls.length > 0 && (
          <TextButton
            onClick={() => {
              clearCallLog();
              setCalls([]);
            }}
          >
            Delete all calls
          </TextButton>
        )}
      </div>
    </div>
  );
}
