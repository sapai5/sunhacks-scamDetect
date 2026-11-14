import * as cdk from 'aws-cdk-lib';
import { Stage1Stack } from '../lib/stage1-stack.js';

const app = new cdk.App();
const ctx = (key: string): string => String(app.node.tryGetContext(key) ?? '');

new Stage1Stack(app, 'ScamShieldStage1', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') || 'us-east-1' },
  elderName: ctx('elderName'),
  verificationQuestion: ctx('verificationQuestion'),
  modelId: ctx('modelId'),
  familyPhone: ctx('familyPhone') || undefined,
  familyEmail: ctx('familyEmail') || undefined,
});
