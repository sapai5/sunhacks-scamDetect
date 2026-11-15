// E9 One past call (not in Figma yet): verdict, scam stages, the full transcript and call events.
// Opened from E8 (or the E6 summary) as /elder/call?id=<callId>.
import { useNavigate, useSearchParams } from 'react-router';
import { EventTimeline } from '../../components/CallEvents';
import { StageTracker, Transcript } from '../../components/Dashboard';
import { RiskLight, TextButton } from '../../components/Risk';
import { deleteCall, getCall, type CallLogEntry } from '../../lib/callLog';
import { stagesOf } from '../../lib/stages';
import { duration, HEADLINE, when } from './E8CallLog';
import './callLog.css';

export default function E9CallDetail({ entry }: { entry?: CallLogEntry }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const call = entry ?? getCall(params.get('id') ?? '');
  if (!call) {
    return (
      <div className="screen-log">
        <h1 className="screen-heading">Call not found</h1>
        <p className="screen-lede">It may have been deleted. Calls are kept on this phone for 30 days.</p>
        <TextButton onClick={() => nav('/elder/calls')}>Back to past calls</TextButton>
      </div>
    );
  }
  return (
    <div className="screen-log">
      <div className="family-head">
        <RiskLight state={call.peak} size="badge" />
        <span className="family-head__meta">
          {when(call.startedAt)} · {duration(call)}
        </span>
      </div>
      <h1 className="screen-heading">{HEADLINE[call.peak]}</h1>
      {call.risk?.reason && <p className="screen-lede">{call.risk.reason}</p>}
      {call.familyAlerted && <p className="screen-note">Your family was told about this call.</p>}
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
