// Loaded only while `npm run dev` is running. Vite drops this import from the production build.
import { Route } from 'react-router';
import Schematic from './screens/Schematic';
import { WORKBENCH_SCREENS } from './workbenchScreens';

export default function DevRoutes() {
  return (
    <>
      <Route path="/schematic" element={<Schematic />} />
      {WORKBENCH_SCREENS.map(({ path, component: Screen, layout, theme }) => (
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
    </>
  );
}
