// Bottom menu for the elder's phone: Home · Past calls · Settings. Not in Figma yet.
// Only on the "between calls" screens: hidden during a live call, the summary and onboarding,
// so the call screen stays one big, simple thing to look at.
import { Link, useLocation } from 'react-router';
import './tabBar.css';

const TABS = [
  { to: '/elder/idle', label: 'Home', match: ['/elder/idle'], icon: <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" /> },
  {
    to: '/elder/calls',
    label: 'Past calls',
    match: ['/elder/calls', '/elder/call'],
    icon: <path d="M5 6h14M5 12h14M5 18h9" />,
  },
  {
    to: '/elder/settings',
    label: 'Settings',
    match: ['/elder/settings'],
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17m10-10 2.1-2.1" />
      </>
    ),
  },
];

/** Paths that show the bar. */
const SHOWN = ['/elder/idle', '/elder/calls', '/elder/call', '/elder/settings'];

export function TabBar() {
  const { pathname } = useLocation();
  if (!SHOWN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <nav className="tab-bar" aria-label="Menu">
      {TABS.map((t) => {
        const active = t.match.some((p) => pathname === p || pathname.startsWith(`${p}/`));
        return (
          <Link key={t.to} to={t.to} className="tab-bar__tab" aria-current={active ? 'page' : undefined}>
            <svg className="tab-bar__icon" viewBox="0 0 24 24" aria-hidden="true">
              {t.icon}
            </svg>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
