// Screens the shipped app routes. The design canvas (dev only) adds the preview frames
// from workbenchScreens.ts. E1, E6, O1–O3 and LIVE are the wired flow (flow/routes.tsx).
import type { ComponentType } from 'react';
import E8CallLog from './screens/elder/E8CallLog';
import E9CallDetail from './screens/elder/E9CallDetail';
import E10Settings from './screens/elder/E10Settings';
import { SETTINGS, SettingsFamilyRoute, SettingsQuestionRoute } from './flow/settingsRoutes';
import { FLOW, IdleRoute, LiveRoute, O1Route, O2Route, O3Route, SummaryRoute } from './flow/routes';

export type Section = 'Elder (smartphone)' | 'Onboarding' | 'Family' | 'Demo dashboard (desktop)';

/** Canvas rows, as laid out in Figma. */
export const ROWS: Section[][] = [['Elder (smartphone)', 'Onboarding', 'Family'], ['Demo dashboard (desktop)']];

export interface ScreenRoute {
  /** Figma frame id prefix, e.g. "E5". */
  id: string;
  /** Rest of the Figma frame name. */
  title: string;
  path: string;
  section: Section;
  layout: 'phone' | 'desktop';
  component: ComponentType;
  theme?: 'dark';
  /** false = routed but not shown on the canvas. */
  inGallery?: boolean;
  owner?: string;
}

/** Routes in the production build. Preview frames stay in workbenchScreens.ts. */
export const APP_SCREENS: ScreenRoute[] = [
  { id: 'LIVE', title: 'Live call', path: FLOW.live, section: 'Elder (smartphone)', layout: 'phone', component: LiveRoute, inGallery: false },

  { id: 'E1', title: 'Idle protected', path: FLOW.idle, section: 'Elder (smartphone)', layout: 'phone', component: IdleRoute },
  { id: 'E6', title: 'Call ended summary', path: FLOW.summary, section: 'Elder (smartphone)', layout: 'phone', component: SummaryRoute },
  { id: 'E8', title: 'Past calls', path: '/elder/calls', section: 'Elder (smartphone)', layout: 'phone', component: E8CallLog },
  { id: 'E9', title: 'Call transcript', path: '/elder/call', section: 'Elder (smartphone)', layout: 'phone', component: E9CallDetail },
  { id: 'E10', title: 'Settings', path: SETTINGS.home, section: 'Elder (smartphone)', layout: 'phone', component: E10Settings },
  { id: 'E10a', title: 'Settings: family', path: SETTINGS.family, section: 'Elder (smartphone)', layout: 'phone', component: SettingsFamilyRoute, inGallery: false },
  { id: 'E10b', title: 'Settings: question', path: SETTINGS.question, section: 'Elder (smartphone)', layout: 'phone', component: SettingsQuestionRoute, inGallery: false },

  { id: 'O1', title: 'Family contacts', path: FLOW.o1, section: 'Onboarding', layout: 'phone', component: O1Route },
  { id: 'O2', title: 'Secret question', path: FLOW.o2, section: 'Onboarding', layout: 'phone', component: O2Route },
  { id: 'O3', title: 'Microphone permission', path: FLOW.o3, section: 'Onboarding', layout: 'phone', component: O3Route },
];
