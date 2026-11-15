// Creates or updates the Fargate bridge's secret (Secrets Manager, JSON) from the same local files
// the laptop bridge uses: backend/twilio/.env and backend/local.config.json. Nothing is printed.
// Usage: npx tsx scripts/bridge-secret.ts   (uses the current AWS profile / account)
import { existsSync, readFileSync } from 'node:fs';
import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { BRIDGE_SECRET_NAME } from '../lib/bridge-stack.js';

const envPath = new URL('../twilio/.env', import.meta.url);
if (!existsSync(envPath)) throw new Error('backend/twilio/.env not found');
process.loadEnvFile(envPath);
const local = JSON.parse(readFileSync(new URL('../local.config.json', import.meta.url), 'utf8')) as {
  elderPhone: string;
  trustedContacts?: string[];
};

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from backend/twilio/.env`);
  return v;
};
const value = JSON.stringify({
  TWILIO_ACCOUNT_SID: need('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: need('TWILIO_AUTH_TOKEN'),
  TWILIO_NUMBER: need('TWILIO_NUMBER'),
  TWILIO_DIAL_FROM: process.env.TWILIO_DIAL_FROM || need('TWILIO_NUMBER'),
  ELDER_PHONE: local.elderPhone,
  // ECS needs every referenced key to exist, so an empty list is stored as an empty string.
  TRUSTED_CONTACTS: (local.trustedContacts ?? []).join(','),
});

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
try {
  await sm.send(new PutSecretValueCommand({ SecretId: BRIDGE_SECRET_NAME, SecretString: value }));
  console.log(`updated secret ${BRIDGE_SECRET_NAME}`);
} catch (err) {
  if (!(err instanceof ResourceNotFoundException)) throw err;
  await sm.send(new CreateSecretCommand({ Name: BRIDGE_SECRET_NAME, SecretString: value, Description: 'Call Me Maybe... NOT Twilio bridge (Fargate)' }));
  console.log(`created secret ${BRIDGE_SECRET_NAME}`);
}
