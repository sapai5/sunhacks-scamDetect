import { Route, Routes } from 'react-router';
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

export default function App() {
  return (
    <CallProvider>
      <CallLogRecorder />
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
