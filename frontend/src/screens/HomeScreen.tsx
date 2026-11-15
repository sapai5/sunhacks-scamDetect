import { useNavigation } from '../app/navigation';
import { AlertBanner, Button, RiskLight, StatusDot } from '../components';
import { useCallController } from '../features/call/CallSessionContext';
import { useServices } from '../services/ServicesContext';
import s from './HomeScreen.module.css';

export function HomeScreen() {
  const { services } = useServices();
  const controller = useCallController();
  const { navigate } = useNavigation();

  const startMic = () => {
    void controller.start(services.createMicSource(), 'mic');
    navigate('call');
  };
  const startDemo = (id: string, title: string) => {
    void controller.start(services.createScriptSource(id), 'demo', title);
    navigate('call');
  };

  return (
    <main className="screen">
      <header className={s.header}>
        <h1 className={s.brand}>Scam Shield</h1>
        <button className={s.settings} onClick={() => navigate('settings')} aria-label="Setup and connection">
          <StatusDot tone={services.mode === 'aws' ? 'green' : 'yellow'} />
          Setup
        </button>
      </header>

      {services.mode === 'mock' && (
        <AlertBanner>Practice mode: not connected to AWS. Demo calls work; live listening is off.</AlertBanner>
      )}

      <RiskLight level="green" idle label="Ready" />
      <p className={`center ${s.lead}`}>Put the call on speaker, then tap Start. The light turns red if it sounds like a scam.</p>

      <Button variant="primary" size="lg" onClick={startMic} disabled={!services.micAvailable}>
        Start listening
      </Button>

      <section className="stack" aria-labelledby="demo-title">
        <h2 id="demo-title" className="section-title">
          Try a demo call
        </h2>
        <ul className={s.scripts}>
          {services.demoScripts.map((d) => (
            <li key={d.id}>
              <button className={s.script} onClick={() => startDemo(d.id, d.title)}>
                <StatusDot tone={d.expectedPeak} />
                <span className={s.scriptTitle}>{d.title}</span>
                <span className="subtle">{d.lines.length} lines</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
