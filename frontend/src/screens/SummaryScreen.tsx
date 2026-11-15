import { useEffect } from 'react';
import { useNavigation } from '../app/navigation';
import { AlertBanner, Button, RiskLight, TacticChips, TopBar, Transcript } from '../components';
import { useCallController, useCallSnapshot } from '../features/call/CallSessionContext';
import { formatDuration, LEVEL_LABEL } from '../features/call/labels';
import s from './SummaryScreen.module.css';

const VERIFICATION_LABEL = { unasked: 'Not asked', passed: 'Answered right', failed: 'Answered wrong' } as const;

export function SummaryScreen() {
  const controller = useCallController();
  const call = useCallSnapshot();
  const { navigate } = useNavigation();

  useEffect(() => {
    if (call.phase === 'idle') navigate('home');
  }, [call.phase, navigate]);

  const done = () => {
    controller.reset();
    navigate('home');
  };
  const duration = call.startedAt ? (call.endedAt ?? Date.now()) - call.startedAt : 0;

  return (
    <main className="screen">
      <TopBar title="Call summary" />

      <RiskLight level={call.peakLevel} size="sm" />
      <p className="center muted">Highest level: {LEVEL_LABEL[call.peakLevel]}</p>

      <dl className={s.stats}>
        <div className={s.stat}>
          <dt>Length</dt>
          <dd>{formatDuration(duration)}</dd>
        </div>
        <div className={s.stat}>
          <dt>Peak risk</dt>
          <dd>{call.peakRisk}%</dd>
        </div>
        <div className={s.stat}>
          <dt>Sentences heard</dt>
          <dd>{call.utterances.length}</dd>
        </div>
        <div className={s.stat}>
          <dt>Family check</dt>
          <dd>{VERIFICATION_LABEL[call.verification]}</dd>
        </div>
      </dl>

      {call.tacticsSeen.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Warning signs during the call</h2>
          <TacticChips tactics={call.tacticsSeen} />
        </section>
      )}

      {call.familyAlerted && <AlertBanner tone="danger">Your family was texted during this call.</AlertBanner>}

      <Transcript utterances={call.utterances} />
      <AlertBanner>Nothing from this call was saved. Tapping Done clears it.</AlertBanner>

      <div className="spacer" />
      <Button variant="primary" size="lg" onClick={done}>
        Done
      </Button>
    </main>
  );
}
