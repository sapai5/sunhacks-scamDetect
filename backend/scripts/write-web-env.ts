// After `cdk deploy`, copies the stack outputs into frontend/.env.local for Vite.
import { readFileSync, writeFileSync } from 'node:fs';

const all = JSON.parse(readFileSync(new URL('../cdk-outputs.json', import.meta.url), 'utf8'));
const o = all.ScamShieldStage1;
const d = all.ScamShieldData ?? {};
const env = [
  `VITE_REGION=${o.Region}`,
  `VITE_CREDENTIALS_URL=${o.CredentialsUrl}`,
  `VITE_ANALYZE_URL=${o.AnalyzeUrl}`,
  `VITE_AGENT_URL=${o.AgentUrl}`,
  `VITE_EVENTS_URL=${o.EventsUrl ?? ''}`,
  `VITE_SETTINGS_URL=${d.SettingsUrl ?? ''}`,
].join('\n');
writeFileSync(new URL('../../frontend/.env.local', import.meta.url), env + '\n');
console.log('wrote frontend/.env.local');
console.log(`Amplify app: ${o.AmplifyAppId}  ${o.WebUrl}`);
if (d.PushUrl) console.log(`Push socket: wscat -c "${d.PushUrl}?elderId=e-01" -o http://localhost:5173`);
