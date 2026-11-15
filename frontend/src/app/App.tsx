import { useState, type ComponentType } from 'react';
import { readConfig } from '../config/env';
import { CallSessionProvider } from '../features/call/CallSessionContext';
import { CallScreen } from '../screens/CallScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { createServices } from '../services/createServices';
import { ServicesProvider } from '../services/ServicesContext';
import { NavigationProvider, useNavigation, type ScreenId } from './navigation';

const SCREENS: Record<ScreenId, ComponentType> = {
  home: HomeScreen,
  call: CallScreen,
  summary: SummaryScreen,
  settings: SettingsScreen,
};

function CurrentScreen() {
  const { screen } = useNavigation();
  const Screen = SCREENS[screen];
  return <Screen />;
}

/** Composition root: config -> services -> call session -> screens. */
export function App() {
  const [{ config, services }] = useState(() => {
    const config = readConfig();
    return { config, services: createServices(config) };
  });
  return (
    <ServicesProvider config={config} services={services}>
      <CallSessionProvider>
        <NavigationProvider>
          <CurrentScreen />
        </NavigationProvider>
      </CallSessionProvider>
    </ServicesProvider>
  );
}
