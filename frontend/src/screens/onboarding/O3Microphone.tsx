// O3 Microphone permission. Figma node 15:114.
import { BigButton } from '../../components/Risk';

export interface O3Props {
  /** Asks for mic permission (must come from a tap), then finishes onboarding. */
  onAllow?: () => void;
}

export default function O3Microphone({ onAllow }: O3Props) {
  return (
    <div className="screen-form">
      <h1 className="screen-heading">Let ScamDetermine listen to your calls</h1>
      <p className="screen-body">Calls are transcribed only to look for scams. Your family sees a transcript only when a call turns red.</p>
      <BigButton kind="primary" onClick={onAllow}>
        Allow and finish
      </BigButton>
    </div>
  );
}
