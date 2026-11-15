import { Route, Routes } from 'react-router';
import { StartRoute } from './flow/routes';
import { CallProvider } from './lib/CallContext';
import { SCREENS } from './routes';
import Schematic from './screens/Schematic';

export default function App() {
  return (
    <CallProvider>
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
    </CallProvider>
  );
}
