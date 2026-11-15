// Zips an existing frontend/dist build and pushes it to the Amplify app as a manual deployment.
// Usage: npm run build -w frontend && npm run deploy:web -w backend
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AmplifyClient, CreateDeploymentCommand, StartDeploymentCommand } from '@aws-sdk/client-amplify';

const o = JSON.parse(readFileSync(new URL('../cdk-outputs.json', import.meta.url), 'utf8')).ScamShieldStage1;
const dist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const zip = fileURLToPath(new URL('../../web-dist.zip', import.meta.url));

// tar ships with Windows 10+ and macOS/Linux and can write zip files.
// List top-level entries explicitly: Amplify needs index.html at the zip root, not under "./".
rmSync(zip, { force: true });
execFileSync('tar', ['-a', '-c', '-f', zip, '-C', dist, ...readdirSync(dist)], { stdio: 'inherit' });

const amplify = new AmplifyClient({ region: o.Region });
const appId = o.AmplifyAppId;
const branchName = 'main';
const { jobId, zipUploadUrl } = await amplify.send(new CreateDeploymentCommand({ appId, branchName }));
const put = await fetch(zipUploadUrl!, { method: 'PUT', body: readFileSync(zip), headers: { 'content-type': 'application/zip' } });
if (!put.ok) throw new Error(`upload failed: HTTP ${put.status}`);
await amplify.send(new StartDeploymentCommand({ appId, branchName, jobId }));
console.log(`Deploying job ${jobId} -> ${o.WebUrl}`);
