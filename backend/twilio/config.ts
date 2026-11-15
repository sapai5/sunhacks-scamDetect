// Settings for the Twilio bridge. Secrets come from backend/twilio/.env (gitignored);
// phone numbers from backend/local.config.json (gitignored); AWS endpoints from the deployed stacks.
import { existsSync, readFileSync } from 'node:fs';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const need = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}. Copy backend/twilio/.env.example to backend/twilio/.env and fill it in.`);
  return v;
};

export interface BridgeConfig {
  accountSid: string;
  authToken: string;
  /** The Twilio number scammers call (E.164). */
  twilioNumber: string;
  /** Caller ID when we ring the elder. Trial accounts must use their assigned trial number here. */
  dialFrom: string;
  /** Public https URL of this server (the tunnel), no trailing slash. */
  publicUrl: string;
  port: number;
  region: string;
  elderId: string;
  elderPhone: string;
  /** From local.config.json; merged with Elders.trustedContacts per call. */
  trustedContacts: string[];
  ingestFnName: string;
  callsTable: string;
  eldersTable: string;
  agentUrl: string;
  /** The web app (Amplify), for the links in texts to the elder. */
  webUrl: string;
}

async function outputs(cf: CloudFormationClient, stack: string): Promise<Record<string, string>> {
  const s = (await cf.send(new DescribeStacksCommand({ StackName: stack }))).Stacks?.[0];
  return Object.fromEntries((s?.Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]));
}

export async function loadConfig(): Promise<BridgeConfig> {
  const local = JSON.parse(readFileSync(new URL('../local.config.json', import.meta.url), 'utf8')) as {
    elderPhone: string;
    trustedContacts?: string[];
  };
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const cf = new CloudFormationClient({ region });
  const [stage1, data] = await Promise.all([outputs(cf, 'ScamShieldStage1'), outputs(cf, 'ScamShieldData')]);
  return {
    accountSid: need('TWILIO_ACCOUNT_SID'),
    authToken: need('TWILIO_AUTH_TOKEN'),
    twilioNumber: need('TWILIO_NUMBER'),
    dialFrom: process.env.TWILIO_DIAL_FROM || need('TWILIO_NUMBER'),
    publicUrl: need('PUBLIC_URL').replace(/\/+$/, ''),
    port: Number(process.env.PORT ?? 8080),
    region,
    // Dry runs (the simulator) use "sim", so they don't show up live in the app (no app listens to "sim").
    // Real calls use e-01, the demo phone. Override with ELDER_ID.
    elderId: process.env.ELDER_ID ?? (process.env.TWILIO_DRY_RUN === '1' ? 'sim' : 'e-01'),
    elderPhone: local.elderPhone,
    trustedContacts: local.trustedContacts ?? [],
    ingestFnName: data.IngestFnName,
    callsTable: data.CallsTableName,
    eldersTable: data.EldersTableName,
    agentUrl: stage1.AgentUrl,
    webUrl: process.env.WEB_URL ?? stage1.WebUrl,
  };
}
