// E10 Settings (not in Figma yet). Change what onboarding set up, any time.
import { Link } from 'react-router';
import { AlertsCard } from '../../components/AlertsCard';
import { InstallHint } from '../../components/InstallHint';
import { loadSettings } from '../../lib/settings';
import './callLog.css';

export default function E10Settings() {
  const s = loadSettings();
  const family = s.family.filter((c) => c.name || c.phone);
  return (
    <div className="screen-settings">
      <h1 className="screen-heading">Settings</h1>
      <ul className="settings-list">
        <li>
          <Link className="settings-row" to="/elder/settings/family">
            <span className="settings-row__text">
              <span className="settings-row__title">Family to alert</span>
              <span className="settings-row__meta">{family.length ? family.map((c) => c.name || c.phone).join(', ') : 'No one yet'}</span>
            </span>
            <span className="call-log__chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link className="settings-row" to="/elder/settings/question">
            <span className="settings-row__text">
              <span className="settings-row__title">Family question</span>
              <span className="settings-row__meta">{s.question || 'Not set'}</span>
            </span>
            <span className="call-log__chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
      </ul>
      <AlertsCard variant="settings" />
      <InstallHint />
      <p className="screen-note">Your settings and past calls are kept on this phone.</p>
    </div>
  );
}
