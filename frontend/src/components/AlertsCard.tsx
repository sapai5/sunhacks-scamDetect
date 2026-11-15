// "Get alerts during calls" (Web Push). Not in Figma. On E1 it shows only until alerts are on;
// in Settings (`variant="settings"`) it always shows, with the current state and a test button.
import { useEffect, useState } from 'react';
import { alertsState, disableAlerts, enableAlerts, showTestAlert, type AlertsState } from '../lib/webPush';
import './alertsCard.css';

const COPY: Record<AlertsState, { title: string; body: string }> = {
  off: { title: 'Get alerts during calls', body: 'If a call looks like a scam, a notice appears over your call screen, even when this app is closed.' },
  on: { title: 'Call alerts are on', body: "You'll get a notice over your call screen if a call looks like a scam." },
  blocked: { title: 'Call alerts are blocked', body: 'To turn them on, open your phone’s Settings › Notifications › ScamDetermine.' },
  'needs-install': { title: 'Get alerts during calls', body: 'First add ScamDetermine to your Home Screen (Share › Add to Home Screen), then open it from there.' },
  unsupported: { title: 'Call alerts', body: "This phone or browser can't show call alerts. You'll still get text messages." },
};

export function AlertsCard({ variant = 'home' }: { variant?: 'home' | 'settings' }) {
  const [state, setState] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void alertsState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;
  // Home: only the call to action. Nothing to say when they're on, or when this phone can't do it.
  if (variant === 'home' && (state === 'on' || state === 'unsupported')) return null;

  const run = async (fn: () => Promise<AlertsState>) => {
    setBusy(true);
    setError('');
    try {
      setState(await fn());
    } catch (err) {
      setError(`That didn't work (${(err as Error).message}). Check your internet and try again.`);
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[state];
  return (
    <div className="alerts-card" data-state={state} data-variant={variant} role="group" aria-label="Call alerts">
      <svg className="alerts-card__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      <div className="alerts-card__text">
        <p className="alerts-card__title">{copy.title}</p>
        <p className="alerts-card__body">{copy.body}</p>
        {error && (
          <p className="alerts-card__error" role="alert">
            {error}
          </p>
        )}
        {state === 'off' && (
          <button type="button" className="alerts-card__button" disabled={busy} onClick={() => void run(enableAlerts)}>
            {busy ? 'Turning on…' : 'Turn on alerts'}
          </button>
        )}
        {state === 'on' && variant === 'settings' && (
          <div className="alerts-card__row">
            <button type="button" className="alerts-card__button alerts-card__button--quiet" onClick={() => void showTestAlert()}>
              Show a test alert
            </button>
            <button type="button" className="alerts-card__link" disabled={busy} onClick={() => void run(disableAlerts)}>
              Turn off
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
