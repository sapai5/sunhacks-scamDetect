// E9 One past call (not in Figma yet): verdict, scam stages, the full transcript and call events.
// Opened from E8 (or the E6 summary) as /elder/call?id=<callId>.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { EventTimeline } from '../../components/CallEvents';
import { StageTracker, Transcript } from '../../components/Dashboard';
import { RiskLight, TextButton } from '../../components/Risk';
import { SharedPicker, sharedTitle, useWhatWasShared, WhatNext } from '../../components/WhatNext';
import { detectExposures, mergeExposures } from '../../../../contracts/exposures.js';
import { deleteCall, getCall, type CallLogEntry } from '../../lib/callLog';
import { loadSettings } from '../../lib/settings';
import { stagesOf } from '../../lib/stages';
import { duration, HEADLINE, when } from './E8CallLog';
import './callLog.css';

export default function E9CallDetail({ entry }: { entry?: CallLogEntry }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const [call, setCall] = useState(() => entry ?? getCall(id));
  const [waited, setWaited] = useState(false);
  // Opened from an end-of-call alert, the app may still be saving the call: look again for a few seconds.
  useEffect(() => {
    if (call) return;
    const tick = setInterval(() => setCall(getCall(id)), 500);
    const stop = setTimeout(() => setWaited(true), 5_000);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [call, id]);
  // What the caller got: heard on the call (older calls: worked out from the saved words) plus what the elder taps.
  const detected = call && call.peak !== 'green' ? mergeExposures(call.exposures, detectExposures(call.transcript)) : [];
  const shared = useWhatWasShared(call?.callId ?? id, detected);
  if (!call && !waited) return <div className="screen-log" aria-busy="true" />;
  if (!call) {
    return (
      <div className="screen-log">
        <h1 className="screen-heading">Call not found</h1>
        <p className="screen-lede">It may have been deleted. Calls are kept on this phone for 30 days.</p>
        <TextButton onClick={() => nav('/elder/calls')}>Back to past calls</TextButton>
      </div>
    );
  }
  const risky = call.peak !== 'green';
  const gave = risky && shared.exposures.length > 0;
  return (
    <div className="screen-log">
      <div className="family-head">
        <RiskLight state={call.peak} size="badge" />
        <span className="family-head__meta">
          {when(call.startedAt)} · {duration(call)}
        </span>
      </div>
      <h1 className="screen-heading">{gave ? sharedTitle(shared.exposures) : HEADLINE[call.peak]}</h1>
      {call.risk?.reason && <p className="screen-lede">{call.risk.reason}</p>}
      {call.familyAlerted && <p className="screen-note">Your family was told about this call.</p>}
      {gave && (
        <button
          type="button"
          className="what-next-jump"
          onClick={() => document.getElementById('what-next')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          See what to do now ↓
        </button>
      )}
      <StageTracker hit={stagesOf(call.tactics)} />

      <section className="call-detail__section">
        <p className="eyebrow">What was said</p>
        {call.transcript.length ? (
          <Transcript utterances={call.transcript} history={call.history} startedAt={call.startedAt} />
        ) : (
          <p className="screen-note">
            {call.history.length ? "This phone call was checked by the server, which doesn't send the words to this phone yet." : 'Nothing was heard.'}
          </p>
        )}
      </section>

      {risky && (
        <div id="what-next" className="call-detail__section what-next-block">
          <SharedPicker shared={shared} />
          <WhatNext
            callId={call.callId}
            exposures={shared.exposures}
            scam={call.peak === 'red'}
            familyPhone={loadSettings().family.find((c) => c.phone)?.phone}
          />
        </div>
      )}

      <EventTimeline events={call.events} startedAt={call.startedAt} />

      <div className="screen-actions">
        <TextButton onClick={() => nav('/elder/calls')}>Back to past calls</TextButton>
        <TextButton
          onClick={() => {
            deleteCall(call.callId);
            nav('/elder/calls');
          }}
        >
          Delete this call
        </TextButton>
      </div>
    </div>
  );
}
