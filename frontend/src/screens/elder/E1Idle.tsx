// E1 Idle protected. Figma node 15:3.
// The Figma frame has no buttons; "Start listening" and the demo scripts are added so the demo can start a call.
// Phone path (phoneProtected): calls to the ScamDetermine number open the live screen by themselves,
// so the screen says that, and the speakerphone button and demos move under "Practice".
import { InstallHint } from '../../components/InstallHint';
import { BigButton, RiskLight } from '../../components/Risk';
import { PHONE_PATH } from '../../lib/phonePath';
import type { StartMode } from '../../lib/useCall';
import './idle.css';

export interface E1Props {
  familyCount?: number;
  /** Demo scripts that can stand in for a real call. */
  scripts?: string[];
  micAvailable?: boolean;
  onStart?: (mode: StartMode) => void;
  /** Calls through the ScamDetermine number are checked automatically (push socket configured). */
  phoneProtected?: boolean;
}

export default function E1Idle({ familyCount = 3, scripts = [], micAvailable, onStart, phoneProtected = PHONE_PATH }: E1Props) {
  const family =
    familyCount > 0
      ? `${familyCount} family member${familyCount === 1 ? '' : 's'} will be alerted if you start falling for a scam`
      : 'Add family in Settings so they hear about it if a call looks like a scam';

  const listen = (
    <BigButton kind={phoneProtected ? 'secondary' : 'primary'} disabled={!micAvailable} onClick={() => onStart?.({ kind: 'mic' })}>
      {phoneProtected ? 'Listen on speakerphone' : 'Start listening'}
    </BigButton>
  );
  const demos = scripts.length > 0 && (
    <div className="demo-scripts">
      <p className="eyebrow">Demo call</p>
      {scripts.map((script) => (
        <button key={script} type="button" className="demo-script" onClick={() => onStart?.({ kind: 'demo', script })}>
          {script.replaceAll('-', ' ')}
        </button>
      ))}
    </div>
  );

  if (phoneProtected) {
    return (
      <div className="screen-center">
        <InstallHint />
        <RiskLight state="green" size="badge" label="Protected" />
        <h1 className="screen-title">You're protected</h1>
        <p className="screen-lede">Calls from numbers you don't know are checked while you talk. This screen changes by itself when one comes in.</p>
        <p className="screen-note">{family}</p>
        <p className="screen-note">Calls from your contacts ring through as usual.</p>
        {onStart && (
          <details className="practice">
            <summary className="practice__summary">Practice and other calls</summary>
            <div className="screen-actions">
              <p className="screen-note">For a call that didn't come through ScamDetermine, put it on speaker next to this phone.</p>
              {listen}
              {demos}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="screen-center">
      <InstallHint />
      <RiskLight state="green" size="badge" label="Protected" />
      <h1 className="screen-title">You're protected</h1>
      <p className="screen-lede">ScamDetermine listens to your calls and warns you if one turns into a scam.</p>
      <p className="screen-note">{family}</p>
      <p className="screen-note">Use this for calls from numbers that aren't in your contacts.</p>
      {onStart && (
        <div className="screen-actions">
          {listen}
          {demos}
        </div>
      )}
    </div>
  );
}
