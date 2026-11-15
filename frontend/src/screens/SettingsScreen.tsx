import { useState } from 'react';
import { useNavigation } from '../app/navigation';
import { AlertBanner, Button, StatusDot, TopBar } from '../components';
import { runDiagnostics, type CheckResult } from '../services/diagnostics';
import { useServices } from '../services/ServicesContext';
import s from './SettingsScreen.module.css';

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url || 'not set';
  }
};

export function SettingsScreen() {
  const { services, config } = useServices();
  const { navigate } = useNavigation();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const check = async () => {
    setRunning(true);
    try {
      setChecks(await runDiagnostics(services, config));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="screen">
      <TopBar title="Setup" onBack={() => navigate('home')} />

      {config.mode === 'mock' && (
        <AlertBanner>
          Practice mode. Run <code>npm run deploy -w backend</code> to write the AWS endpoints into <code>frontend/.env.local</code>, then
          restart the dev server.
        </AlertBanner>
      )}

      <section className="stack">
        <h2 className="section-title">Connection</h2>
        <dl className={s.list}>
          <Item label="Backend" value={config.mode === 'aws' ? `AWS (${config.region})` : 'Practice (mock, offline)'} />
          {config.mode === 'aws' && (
            <>
              <Item label="Analyze function" value={host(config.analyzeUrl)} />
              <Item label="Credentials function" value={host(config.credentialsUrl)} />
            </>
          )}
          <Item label="Elder ID" value={config.elderId} />
        </dl>
      </section>

      <section className="stack">
        <h2 className="section-title">Health check</h2>
        <Button variant="primary" onClick={check} disabled={running}>
          {running ? 'Checking…' : 'Check connection'}
        </Button>
        {checks && (
          <ul className={s.checks}>
            {checks.map((c) => (
              <li key={c.id} className={s.check}>
                <div className={s.checkHead}>
                  <span>
                    <StatusDot tone={c.ok ? 'green' : 'red'} />
                    {c.label}
                  </span>
                  {c.ms !== undefined && <span className="subtle">{c.ms} ms</span>}
                </div>
                <p className="subtle">{c.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.item}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
