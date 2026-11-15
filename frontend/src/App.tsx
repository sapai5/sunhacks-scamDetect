import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { StartRoute } from './flow/routes';
import { TabBar } from './components/TabBar';
import { syncSettings } from './lib/api';
import { CallProvider, useCallContext } from './lib/CallContext';
import { useCallLogRecorder } from './lib/callLog';
import { loadSettings, takeSampleFamilyRemoval } from './lib/settings';
import { APP_SCREENS } from './routes';
import './styles/motion.css';

// `import.meta.env.DEV` is false in `vite build`, so Rollup drops this import and the preview screens.
const DevRoutes = import.meta.env.DEV ? lazy(() => import('./devRoutes')) : null;

/** Saves each call (and its transcript) to the on-device call log as it goes. */
function CallLogRecorder() {
  useCallLogRecorder(useCallContext().snapshot);
  return null;
}

/** A tapped call alert (sw.ts) opens its screen in place, so a running call isn't reloaded. */
function NotificationRouter() {
  const nav = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent<{ type?: string; path?: string }>) => {
      if (e.data?.type === 'open' && typeof e.data.path === 'string' && e.data.path.startsWith('/')) nav(e.data.path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [nav]);
  return null;
}

/** Drops the old sample contacts (Maria and James) and clears them on the server. */
function ForgetSampleFamily() {
  useEffect(() => {
    loadSettings();
    const next = takeSampleFamilyRemoval();
    if (next) void syncSettings(next);
  }, []);
  return null;
}

export default function App() {
  return (
    <CallProvider>
      <ForgetSampleFamily />
      <CallLogRecorder />
      <NotificationRouter />
      <Routes>
        <Route path="/" element={<StartRoute />} />
        {DevRoutes && (
          <Suspense fallback={null}>
            <DevRoutes />
          </Suspense>
        )}
        {APP_SCREENS.map(({ path, component: Screen, layout, theme }) => (
          <Route
            key={path}
            path={path}
            element={
              <div className={`layout-${layout}`} data-theme={theme}>
                <Screen />
              </div>
            }
          />
        ))}
        <Route path="*" element={<StartRoute />} />
      </Routes>
      <TabBar />
    </CallProvider>
  );
}
