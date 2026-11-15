// E1 Idle protected. Figma node 15:3.
// The Figma frame has no buttons; "Start listening" and the demo scripts are added so the demo can start a call.
import { BigButton, RiskLight } from '../../components/Risk';
import type { StartMode } from '../../lib/useCall';

export interface E1Props {
  familyCount?: number;
  /** Demo scripts that can stand in for a real call. */
  scripts?: string[];
  micAvailable?: boolean;
  onStart?: (mode: StartMode) => void;
}

export default function E1Idle({ familyCount = 3, scripts = [], micAvailable, onStart }: E1Props) {
  return (
    <div className="screen-center">
      <RiskLight state="green" size="badge" label="Protected" />
      <h1 className="screen-title">You're protected</h1>
      <p className="screen-lede">ScamDetermine listens to your calls and warns you if one turns into a scam.</p>
      <p className="screen-note">
        {familyCount} family member{familyCount === 1 ? '' : 's'} will be alerted if you start falling for a scam
      </p>
      <p className="screen-note">Use this for calls from numbers that aren't in your contacts.</p>

      {onStart && (
        <div className="screen-actions">
          <BigButton kind="primary" disabled={!micAvailable} onClick={() => onStart({ kind: 'mic' })}>
            Start listening
          </BigButton>
          {scripts.length > 0 && (
            <div className="demo-scripts">
              <p className="eyebrow">Demo call</p>
              {scripts.map((script) => (
                <button key={script} type="button" className="demo-script" onClick={() => onStart({ kind: 'demo', script })}>
                  {script.replaceAll('-', ' ')}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
