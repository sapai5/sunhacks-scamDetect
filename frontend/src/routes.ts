// Every screen in one list, named and ordered like the Figma "03 Screens" page.
// The schematic (/schematic) and the router both read this. E1, E6, O1–O3 and LIVE are the
// wired demo flow (see flow/routes.tsx); the other E screens are static previews with sample data. To claim a screen, put your name in `owner`.
import type { ComponentType } from 'react';
import D1LiveCall from './screens/dashboard/D1LiveCall';
import D2Verification from './screens/dashboard/D2Verification';
import D3Adjudication from './screens/dashboard/D3Adjudication';
import D4Metrics from './screens/dashboard/D4Metrics';
import D5LoadTest from './screens/dashboard/D5LoadTest';
import E1aListening from './screens/elder/E1aListening';
import E2Green from './screens/elder/E2Green';
import E3Yellow from './screens/elder/E3Yellow';
import E4Verifying from './screens/elder/E4Verifying';
import E5Red from './screens/elder/E5Red';
import F1SmsAlert from './screens/family/F1SmsAlert';
import F2CallSummary from './screens/family/F2CallSummary';
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

export const SCREENS: ScreenRoute[] = [
  { id: 'LIVE', title: 'Live call', path: FLOW.live, section: 'Elder (smartphone)', layout: 'phone', component: LiveRoute, inGallery: false },

  { id: 'E1', title: 'Idle protected', path: FLOW.idle, section: 'Elder (smartphone)', layout: 'phone', component: IdleRoute },
  { id: 'E1a', title: 'Call listening', path: '/elder/listening', section: 'Elder (smartphone)', layout: 'phone', component: E1aListening },
  { id: 'E2', title: 'Call green', path: '/elder/green', section: 'Elder (smartphone)', layout: 'phone', component: E2Green },
  { id: 'E3', title: 'Call yellow', path: '/elder/yellow', section: 'Elder (smartphone)', layout: 'phone', component: E3Yellow },
  { id: 'E4', title: 'Call verifying', path: '/elder/verifying', section: 'Elder (smartphone)', layout: 'phone', component: E4Verifying },
  { id: 'E5', title: 'Call red', path: '/elder/red', section: 'Elder (smartphone)', layout: 'phone', component: E5Red },
  { id: 'E6', title: 'Call ended summary', path: FLOW.summary, section: 'Elder (smartphone)', layout: 'phone', component: SummaryRoute },
  { id: 'E5', title: 'Call red (Dark preview)', path: '/elder/red-dark', section: 'Elder (smartphone)', layout: 'phone', component: E5Red, theme: 'dark' },

  { id: 'O1', title: 'Family contacts', path: FLOW.o1, section: 'Onboarding', layout: 'phone', component: O1Route },
  { id: 'O2', title: 'Secret question', path: FLOW.o2, section: 'Onboarding', layout: 'phone', component: O2Route },
  { id: 'O3', title: 'Microphone permission', path: FLOW.o3, section: 'Onboarding', layout: 'phone', component: O3Route },

  { id: 'F1', title: 'SMS alert', path: '/family/sms', section: 'Family', layout: 'phone', component: F1SmsAlert },
  { id: 'F2', title: 'Call summary', path: '/family/summary', section: 'Family', layout: 'phone', component: F2CallSummary },

  { id: 'D1', title: 'Live call', path: '/dashboard/live', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D1LiveCall },
  { id: 'D2', title: 'Verification moment', path: '/dashboard/verification', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D2Verification },
  { id: 'D3', title: 'Bedrock adjudication', path: '/dashboard/adjudication', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D3Adjudication },
  { id: 'D4', title: 'Metrics', path: '/dashboard/metrics', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D4Metrics },
  { id: 'D5', title: 'Load test', path: '/dashboard/load', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D5LoadTest },
];
