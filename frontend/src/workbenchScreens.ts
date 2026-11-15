// Design-canvas frames. Imported only from the dev router, so a production build leaves them out.
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
import E7Takeover from './screens/elder/E7Takeover';
import E11WhatNext from './screens/elder/E11WhatNext';
import F1SmsAlert from './screens/family/F1SmsAlert';
import F2CallSummary from './screens/family/F2CallSummary';
import type { ScreenRoute } from './routes';

export const WORKBENCH_SCREENS: ScreenRoute[] = [
  { id: 'E1a', title: 'Call listening', path: '/elder/listening', section: 'Elder (smartphone)', layout: 'phone', component: E1aListening },
  { id: 'E2', title: 'Call green', path: '/elder/green', section: 'Elder (smartphone)', layout: 'phone', component: E2Green },
  { id: 'E3', title: 'Call yellow', path: '/elder/yellow', section: 'Elder (smartphone)', layout: 'phone', component: E3Yellow },
  { id: 'E4', title: 'Call verifying', path: '/elder/verifying', section: 'Elder (smartphone)', layout: 'phone', component: E4Verifying },
  { id: 'E5', title: 'Call red', path: '/elder/red', section: 'Elder (smartphone)', layout: 'phone', component: E5Red },
  { id: 'E7', title: 'Family takeover', path: '/elder/takeover', section: 'Elder (smartphone)', layout: 'phone', component: E7Takeover },
  { id: 'E11', title: 'What to do now (preview)', path: '/elder/what-next', section: 'Elder (smartphone)', layout: 'phone', component: E11WhatNext },
  { id: 'E5d', title: 'Call red (Dark preview)', path: '/elder/red-dark', section: 'Elder (smartphone)', layout: 'phone', component: E5Red, theme: 'dark' },

  { id: 'F1', title: 'SMS alert', path: '/family/sms', section: 'Family', layout: 'phone', component: F1SmsAlert },
  { id: 'F2', title: 'Call summary', path: '/family/summary', section: 'Family', layout: 'phone', component: F2CallSummary },

  { id: 'D1', title: 'Live call', path: '/dashboard/live', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D1LiveCall },
  { id: 'D2', title: 'Verification moment', path: '/dashboard/verification', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D2Verification },
  { id: 'D3', title: 'Bedrock adjudication', path: '/dashboard/adjudication', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D3Adjudication },
  { id: 'D4', title: 'Metrics', path: '/dashboard/metrics', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D4Metrics },
  { id: 'D5', title: 'Load test', path: '/dashboard/load', section: 'Demo dashboard (desktop)', layout: 'desktop', component: D5LoadTest },
];
