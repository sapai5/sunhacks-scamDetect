import { useEffect } from 'react';
import { useNavigation } from '../app/navigation';
import { AlertBanner, Button, RiskLight, RiskMeter, TacticChips, Transcript, VerificationCard } from '../components';
import { useCallController, useCallSnapshot } from '../features/call/CallSessionContext';
import { LEVEL_ADVICE } from '../features/call/labels';
import s from './CallScreen.module.css';

export function CallScreen() {
  const controller = useCallController();
  const call = useCallSnapshot();
  const { navigate } = useNavigation();

  // Nothing to show without a call (e.g. after a reset).
  useEffect(() => {
    if (call.phase === 'idle') navigate('home');
  }, [call.phase, navigate]);

  const failedToStart = call.phase === 'ended' && call.utterances.length === 0 && call.error;
  const live = call.phase === 'connecting' || call.phase === 'active';

  const endCall = () => {
    controller.stop();
    navigate('summary');
  };
  const backHome = () => {
    controller.reset();
    navigate('home');
  };

  return (
    <main className="screen">
      <p className={s.source}>
        {call.source === 'demo' ? `Demo call · ${call.sourceLabel}` : 'Live call'}
        {call.analyzing ? ' · checking…' : ''}
      </p>

      <RiskLight level={call.risk.level} idle={call.phase === 'connecting' || Boolean(failedToStart)} />
      <RiskMeter risk={call.risk.risk} />

      {call.utterances.length > 0 && <p className={s.advice}>{LEVEL_ADVICE[call.risk.level]}</p>}
      <p className={s.reason}>{call.risk.reason}</p>
      <TacticChips tactics={call.risk.tactics} />

      {call.pendingQuestion && (
        <VerificationCard question={call.pendingQuestion} onAnswer={(r) => controller.answerVerification(r)} />
      )}

      {call.familyAlerted && <AlertBanner tone="danger">Your family has been texted.</AlertBanner>}

      {failedToStart ? (
        <>
          <AlertBanner tone="danger">{call.status}</AlertBanner>
          <Button variant="primary" size="lg" onClick={backHome}>
            Back
          </Button>
        </>
      ) : (
        <Button variant={live ? 'secondary' : 'primary'} size="lg" onClick={live ? endCall : () => navigate('summary')}>
          {live ? 'End call' : 'See summary'}
        </Button>
      )}

      <Transcript utterances={call.utterances} partial={call.partial} />
      <p className={s.status} aria-live="polite">
        {failedToStart ? '' : call.status}
      </p>
    </main>
  );
}
