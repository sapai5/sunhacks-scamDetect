// After `cdk deploy`, copies the stack outputs into frontend/.env.local for Vite.
import { readFileSync, writeFileSync } from 'node:fs';

const o = JSON.parse(readFileSync(new URL('../cdk-outputs.json', import.meta.url), 'utf8')).ScamShieldStage1;
const env = [
  `VITE_REGION=${o.Region}`,
  `VITE_CREDENTIALS_URL=${o.CredentialsUrl}`,
  `VITE_ANALYZE_URL=${o.AnalyzeUrl}`,
  `VITE_AGENT_URL=${o.AgentUrl}`,
].join('\n');
writeFileSync(new URL('../../frontend/.env.local', import.meta.url), env + '\n');
console.log('wrote frontend/.env.local');
console.log(`Amplify app: ${o.AmplifyAppId}  ${o.WebUrl}`);
