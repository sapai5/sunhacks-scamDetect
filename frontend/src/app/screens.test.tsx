// Smoke test: every screen renders inside the real provider stack (mock services).
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../config/env';
import { CallSessionProvider } from '../features/call/CallSessionContext';
import { CallScreen } from '../screens/CallScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { createServices } from '../services/createServices';
import { ServicesProvider } from '../services/ServicesContext';
import { NavigationProvider } from './navigation';

const config = readConfig({ VITE_SERVICE_MODE: 'mock' } as ImportMetaEnv);
const render = (el: React.ReactNode) =>
  renderToString(
    <ServicesProvider config={config} services={createServices(config)}>
      <CallSessionProvider>
        <NavigationProvider>{el}</NavigationProvider>
      </CallSessionProvider>
    </ServicesProvider>,
  );

describe('screens', () => {
  it('home lists demo calls and disables the mic in mock mode', () => {
    const html = render(<HomeScreen />);
    expect(html).toContain('Grandparent scam');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Start listening/);
    expect(html).toContain('Practice mode');
  });
  it('call, summary and setup render', () => {
    expect(render(<CallScreen />)).toContain('What we heard');
    expect(render(<SummaryScreen />)).toContain('Call summary');
    expect(render(<SettingsScreen />)).toContain('Check connection');
  });
});
