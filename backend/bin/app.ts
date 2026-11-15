import { existsSync, readFileSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { BridgeStack } from '../lib/bridge-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { Stage1Stack } from '../lib/stage1-stack.js';
import { TelephonyStack } from '../lib/telephony-stack.js';

const app = new cdk.App();
const ctx = (key: string): string => String(app.node.tryGetContext(key) ?? '');
const ctxList = (key: string): string[] => app.node.tryGetContext(key) ?? [];
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') || 'us-east-1' };
const eldersTableName = 'ScamShieldElders';

const stage1 = new Stage1Stack(app, 'ScamShieldStage1', {
  env,
  elderName: ctx('elderName'),
  verificationQuestion: ctx('verificationQuestion'),
  verificationAnswer: ctx('verificationAnswer'),
  agentName: ctx('agentName'),
  agentRelation: ctx('agentRelation'),
  modelId: ctx('modelId'),
  familyPhone: ctx('familyPhone') || undefined,
  familyEmail: ctx('familyEmail') || undefined,
  webOrigins: ctxList('webOrigins'),
  eldersTableName,
});

new DataStack(app, 'ScamShieldData', {
  env,
  eldersTableName,
  modelId: ctx('modelId'),
  familyTopic: stage1.familyTopic,
  webOrigins: stage1.webOrigins,
  seed: {
    elderId: 'e-01',
    elderName: ctx('elderName'),
    verificationQuestion: ctx('verificationQuestion'),
    verificationAnswer: ctx('verificationAnswer'),
    agentName: ctx('agentName'),
    agentRelation: ctx('agentRelation'),
    family: [],
    trustedContacts: ctxList('trustedContacts'),
  },
});

// The Twilio bridge on Fargate (replaces the laptop + tunnel). Deploy with
// `npx cdk deploy ScamShieldBridge` after creating its secret (scripts/bridge-secret.ts).
// Optional: -c transcribeRoleArn=arn:aws:iam::<other account>:role/... to run Transcribe elsewhere.
// The role ARN can also live in the gitignored local.config.json ("transcribeRoleArn"), so redeploys keep it.
const localConfigPath = new URL('../local.config.json', import.meta.url);
const localTranscribeRole = existsSync(localConfigPath)
  ? (JSON.parse(readFileSync(localConfigPath, 'utf8')) as { transcribeRoleArn?: string }).transcribeRoleArn
  : undefined;
new BridgeStack(app, 'ScamShieldBridge', {
  env,
  transcribeRoleArn: ctx('transcribeRoleArn') || localTranscribeRole || undefined,
});

// Stage 2 (Track A). Real phone numbers live in backend/local.config.json, which is gitignored
// because the repo is public. Copy local.config.example.json to get started.
const localPath = new URL('../local.config.json', import.meta.url);
if (existsSync(localPath)) {
  const local = JSON.parse(readFileSync(localPath, 'utf8')) as {
    elderPhone: string;
    trustedContacts: string[];
    numberPrefix?: string;
    audioRetentionHours?: number;
    withCallPath?: boolean;
  };
  new TelephonyStack(app, 'ScamShieldTelephony', {
    env,
    elderPhone: local.elderPhone,
    trustedContacts: local.trustedContacts.join(','),
    numberPrefix: local.numberPrefix || undefined,
    audioRetentionHours: local.audioRetentionHours ?? 1,
    withCallPath: local.withCallPath ?? true,
  });
}
