import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Stage1StackProps extends cdk.StackProps {
  elderName: string;
  verificationQuestion: string;
  /** Only the Agent Lambda gets this. */
  verificationAnswer: string;
  /** The family member the takeover agent speaks as. */
  agentName: string;
  agentRelation: string;
  modelId: string;
  /** E.164, e.g. +14805551234. Must be a verified number while SMS is in sandbox. */
  familyPhone?: string;
  /** Fallback channel if SMS isn't approved in time. */
  familyEmail?: string;
}

/**
 * Stage 1: browser -> Transcribe, browser -> Analyze Lambda -> Bedrock (+ SNS alert),
 * browser -> Agent Lambda -> Bedrock for the family-member takeover.
 * Services: Transcribe, Lambda, Bedrock, SNS/SMS, Amplify Hosting.
 */
export class Stage1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Stage1StackProps) {
    super(scope, id, props);

    const cors: lambda.FunctionUrlCorsOptions = {
      // Hackathon: any origin. Lock this to the Amplify domain once it's known.
      allowedOrigins: ['*'],
      allowedMethods: [lambda.HttpMethod.POST],
      allowedHeaders: ['content-type'],
      maxAge: cdk.Duration.minutes(10),
    };

    const fnDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, sourceMap: true },
    };

    // --- Family alert: SNS topic, texts (and optionally emails) the family on red.
    const familyTopic = new sns.Topic(this, 'FamilyAlerts', { displayName: 'Scam Shield' });
    if (props.familyPhone) familyTopic.addSubscription(new subs.SmsSubscription(props.familyPhone));
    if (props.familyEmail) familyTopic.addSubscription(new subs.EmailSubscription(props.familyEmail));

    // --- Credentials Lambda: hands the browser 15-minute creds that can only open
    // a Transcribe streaming WebSocket. Uses STS AssumeRole instead of a Cognito
    // identity pool: same result, one less service to configure.
    const credentialsFn = new NodejsFunction(this, 'CredentialsFn', {
      ...fnDefaults,
      entry: path.join(here, '../lambda/credentials/index.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      logGroup: new logs.LogGroup(this, 'CredentialsLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const browserTranscribeRole = new iam.Role(this, 'BrowserTranscribeRole', {
      assumedBy: new iam.ArnPrincipal(credentialsFn.role!.roleArn),
      description: 'Assumed for browser clients. Transcribe streaming only.',
      maxSessionDuration: cdk.Duration.hours(1),
    });
    browserTranscribeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['transcribe:StartStreamTranscriptionWebSocket'],
        resources: ['*'], // Transcribe streaming has no resource-level permissions.
      }),
    );
    browserTranscribeRole.grantAssumeRole(credentialsFn.role!);
    credentialsFn.addEnvironment('TRANSCRIBE_ROLE_ARN', browserTranscribeRole.roleArn);

    // --- Analyze Lambda: last ~60 s of transcript -> Bedrock -> level rules -> SNS on red.
    const analyzeFn = new NodejsFunction(this, 'AnalyzeFn', {
      ...fnDefaults,
      entry: path.join(here, '../lambda/analyze/index.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        MODEL_ID: props.modelId,
        ELDER_NAME: props.elderName,
        VERIFICATION_QUESTION: props.verificationQuestion,
        FAMILY_TOPIC_ARN: familyTopic.topicArn,
      },
      logGroup: new logs.LogGroup(this, 'AnalyzeLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    // --- Agent Lambda: speaks as a family member once the elder is clearly falling for a scam.
    const agentFn = new NodejsFunction(this, 'AgentFn', {
      ...fnDefaults,
      entry: path.join(here, '../lambda/agent/index.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        MODEL_ID: props.modelId,
        ELDER_NAME: props.elderName,
        AGENT_NAME: props.agentName,
        AGENT_RELATION: props.agentRelation,
        VERIFICATION_QUESTION: props.verificationQuestion,
        VERIFICATION_ANSWER: props.verificationAnswer,
        FAMILY_TOPIC_ARN: familyTopic.topicArn,
      },
      logGroup: new logs.LogGroup(this, 'AgentLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const invokeClaude = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        // Cross-region inference profiles (us.*) route to the model in several regions.
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*anthropic.claude-*`,
      ],
    });
    for (const fn of [analyzeFn, agentFn]) {
      fn.addToRolePolicy(invokeClaude);
      familyTopic.grantPublish(fn);
    }

    const credentialsUrl = credentialsFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, cors });
    const analyzeUrl = analyzeFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, cors });
    const agentUrl = agentFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, cors });

    // --- Amplify Hosting for the PWA (manual zip deploy, no Git connection).
    const webApp = new amplify.CfnApp(this, 'WebApp', {
      name: 'scam-shield',
      platform: 'WEB',
      // Single-page app: any path that isn't a static file serves index.html (Amplify docs' SPA rule).
      customRules: [
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webmanifest)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
    });
    const branch = new amplify.CfnBranch(this, 'WebMain', {
      appId: webApp.attrAppId,
      branchName: 'main',
      stage: 'PRODUCTION',
    });

    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'CredentialsUrl', { value: credentialsUrl.url });
    new cdk.CfnOutput(this, 'AnalyzeUrl', { value: analyzeUrl.url });
    new cdk.CfnOutput(this, 'AgentUrl', { value: agentUrl.url });
    new cdk.CfnOutput(this, 'FamilyTopicArn', { value: familyTopic.topicArn });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: webApp.attrAppId });
    new cdk.CfnOutput(this, 'WebUrl', { value: `https://${branch.branchName}.${webApp.attrDefaultDomain}` });
  }
}
