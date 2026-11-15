// E4 Call verifying ("Checking"). Figma node 15:47.
// risk.action === 'ask_verification'. The backend has no text-to-speech (Figma's "Polly
// speaking"), so the elder asks the question out loud and taps what happened.
import { BigButton, SpeakingPill, TextButton } from '../../components/Risk';
import { RISK } from '../../lib/fixtures';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E4Verifying({ risk = RISK.verifying, elapsed, onAnswer, onEnd }: CallScreenProps) {
  const q = risk?.verificationQuestion;
  return (
    <CallLayout state="verifying" elapsed={elapsed} panelBody={q ? <>Ask the caller: “{q}”</> : undefined}>
      <SpeakingPill>Did they get it right?</SpeakingPill>
      <div className="button-row">
        <BigButton kind="primary" onClick={() => onAnswer?.('passed')}>
          Yes
        </BigButton>
        <BigButton kind="hangup" onClick={() => onAnswer?.('failed')}>
          No
        </BigButton>
      </div>
      {onEnd && <TextButton onClick={onEnd}>End call</TextButton>}
    </CallLayout>
  );
}
