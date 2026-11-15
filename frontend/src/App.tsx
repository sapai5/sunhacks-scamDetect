import { useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { StartRoute } from './flow/routes';
import { TabBar } from './components/TabBar';
import { CallProvider, useCallContext } from './lib/CallContext';
import { useCallLogRecorder } from './lib/callLog';
import { SCREENS } from './routes';
import Schematic from './screens/Schematic';
import './styles/motion.css';

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

export default function App() {
  return (
    <CallProvider>
      <CallLogRecorder />
      <NotificationRouter />
      <Routes>
        <Route path="/" element={<StartRoute />} />
        <Route path="/schematic" element={<Schematic />} />
        {SCREENS.map(({ path, component: Screen, layout, theme }) => (
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
