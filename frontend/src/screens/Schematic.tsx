// "/schematic" — a copy of the Figma "03 Screens" canvas. Each frame is the real route,
// rendered live in a scaled-down iframe, so the canvas fills in as screens get built.
import { Link, useNavigate } from 'react-router';
import { FLOW } from '../flow/routes';
import { resetSettings } from '../lib/settings';
import { MIC_AVAILABLE, USE_MOCK } from '../lib/api';
import { APP_SCREENS, ROWS, type ScreenRoute } from '../routes';
import { WORKBENCH_SCREENS } from '../workbenchScreens';

const SCREENS = [...APP_SCREENS, ...WORKBENCH_SCREENS];

const FRAME = {
  phone: { w: 393, h: 852, scale: 0.5 },
  desktop: { w: 1440, h: 900, scale: 0.32 },
};

function Frame({ s }: { s: ScreenRoute }) {
  const f = FRAME[s.layout];
  return (
    <Link to={s.path} className="frame">
      <span className="frame-name">
        <b>{s.id}</b> {s.title}
        {s.owner && <span className="owner"> · {s.owner}</span>}
      </span>
      <span className="frame-box" style={{ width: f.w * f.scale, height: f.h * f.scale }}>
        <iframe
          src={s.path}
          title={`${s.id} ${s.title}`}
          loading="lazy"
          tabIndex={-1}
          width={f.w}
          height={f.h}
          style={{ transform: `scale(${f.scale})` }}
        />
      </span>
    </Link>
  );
}

export default function Schematic() {
  const nav = useNavigate();
  return (
    <main className="canvas">
      <header className="canvas-head">
        <h1>Call Me Maybe... NOT · 03 Screens</h1>
        <div className="canvas-meta">
          <span className="chip" style={{ '--dot': USE_MOCK ? 'var(--color-careful)' : 'var(--color-safe)' } as React.CSSProperties}>
            analyze: {USE_MOCK ? 'local mock' : 'live lambda'}
          </span>
          <span className="chip" style={{ '--dot': MIC_AVAILABLE ? 'var(--color-safe)' : 'var(--color-listening)' } as React.CSSProperties}>
            mic: {MIC_AVAILABLE ? 'available' : 'not configured'}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              resetSettings();
              nav(FLOW.start);
            }}
          >
            Restart onboarding
          </button>
          <Link to={FLOW.start} className="btn-live">
            Run demo flow →
          </Link>
        </div>
      </header>

      {ROWS.map((row) => (
        <div className="canvas-row" key={row.join()}>
          {row.map((section) => (
            <section className="canvas-section" key={section}>
              <h2>{section}</h2>
              <div className="canvas-frames">
                {SCREENS.filter((s) => s.section === section && s.inGallery !== false).map((s) => (
                  <Frame key={s.path} s={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}
    </main>
  );
}
