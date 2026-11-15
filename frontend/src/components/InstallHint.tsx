// "Add to Home Screen" card. Not in Figma: shown on E1 only while the app runs in a browser tab.
// Android/Chrome: one-tap install. iOS Safari: there is no install API, so show the Share-sheet steps.
import { useState } from 'react';
import { useInstall } from '../lib/pwa';
import './components.css';

export function InstallHint() {
  const { mode, install } = useInstall();
  const [dismissed, setDismissed] = useState(false);
  if (!mode || dismissed) return null;
  return (
    <div className="install-hint" role="note">
      <div className="install-hint__text">
        <p className="install-hint__title">Add ScamDetermine to your Home Screen</p>
        {mode === 'ios' ? (
          <p className="install-hint__body">
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen and keeps working on bad Wi-Fi.
          </p>
        ) : (
          <p className="install-hint__body">Opens full screen, like a regular app.</p>
        )}
      </div>
      <div className="install-hint__actions">
        {mode === 'prompt' && (
          <button type="button" className="install-hint__install" onClick={() => void install()}>
            Install
          </button>
        )}
        <button type="button" className="install-hint__close" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          ×
        </button>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="install-hint__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
