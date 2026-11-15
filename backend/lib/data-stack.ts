import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marshall } from '@aws-sdk/util-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as sns from 'aws-cdk-lib/aws-sns';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { ElderSettings } from '../../contracts/index.js';
import { fnDefaults, invokeClaude } from './stage1-stack.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface DataStackProps extends cdk.StackProps {
  eldersTableName: string;
  modelId: string;
  familyTopic: sns.ITopic;
  /** Origins the Settings URL's CORS and the push socket accept (from Stage1Stack.webOrigins). */
  webOrigins: string[];
  /** First settings for the demo elder, from cdk.json. Written once, when the table is created. */
  seed: ElderSettings;
}

/**
 * Track B: call state, settings, push.
 * Elders + Calls tables, Settings API, IngestFn (server-side analyze for the phone path),
 * and a WebSocket API that pushes each call's RiskState and agent progress from the Calls stream to the app.
 */
export class DataStack extends cdk.Stack {
  /** Track A's transcriber invokes this once per finished sentence (IngestRequest). */
  readonly ingestFn: lambda.IFunction;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const fn = (name: string, entry: string, env: Record<string, string>, memorySize = 256) =>
      new NodejsFunction(this, name, {
        ...fnDefaults,
        entry: path.join(here, `../lambda/${entry}/index.ts`),
        memorySize,
        timeout: cdk.Duration.seconds(15),
        environment: env,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

    // --- B1: tables. Demo data, so both are destroyed with the stack.
    const elders = new dynamodb.Table(this, 'Elders', {
      tableName: props.eldersTableName,
      partitionKey: { name: 'elderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const calls = new dynamodb.Table(this, 'Calls', {
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Seed the demo elder once; never overwrites settings saved later.
    new cr.AwsCustomResource(this, 'SeedElder', {
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        parameters: {
          TableName: elders.tableName,
          Item: marshall(props.seed),
          ConditionExpression: 'attribute_not_exists(elderId)',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`seed-${props.seed.elderId}`),
        ignoreErrorCodesMatching: 'ConditionalCheckFailed',
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [elders.tableArn] }),
      installLatestAwsSdk: false,
    });

    // --- B2: Settings API. GET/PUT from the app; the Analyze/Agent/Ingest Lambdas read the table directly.
    const settingsFn = fn('SettingsFn', 'settings', { ELDERS_TABLE: elders.tableName });
    elders.grantReadWriteData(settingsFn);
    const settingsUrl = settingsFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: props.webOrigins,
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.PUT],
        allowedHeaders: ['content-type'],
        maxAge: cdk.Duration.minutes(10),
      },
    });

    // --- B3: IngestFn. Direct invoke only, no URL.
    const ingestFn = fn(
      'IngestFn',
      'ingest',
      {
        MODEL_ID: props.modelId,
        FAMILY_TOPIC_ARN: props.familyTopic.topicArn,
        ELDERS_TABLE: elders.tableName,
        CALLS_TABLE: calls.tableName,
      },
      512,
    );
    ingestFn.addToRolePolicy(invokeClaude(this));
    props.familyTopic.grantPublish(ingestFn);
    elders.grant(ingestFn, 'dynamodb:GetItem');
    calls.grantReadWriteData(ingestFn);
    this.ingestFn = ingestFn;

    // --- B4: push. $connect registers the socket on the elder; the Calls stream sends each change the
    // app shows; $default takes "Let me talk" and the Checking screen's answer from the app.
    const pushFn = fn('PushFn', 'push', {
      ELDERS_TABLE: elders.tableName,
      CALLS_TABLE: calls.tableName,
      INGEST_FN: ingestFn.functionName,
      ALLOWED_ORIGINS: props.webOrigins.join(','),
      // Web Push: VAPID keys in SSM (made on first use), the app's URL as the VAPID subject.
      VAPID_PARAM: '/scamshield/vapid',
      WEB_URL: props.webOrigins[0] ?? '',
    });
    pushFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/scamshield/vapid`],
      }),
    );
    ingestFn.grantInvoke(pushFn); // rescore after the elder answers the family question
    const pushApi = new apigwv2.WebSocketApi(this, 'PushApi', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('PushConnect', pushFn) },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('PushDefault', pushFn) },
    });
    const pushStage = new apigwv2.WebSocketStage(this, 'PushStage', { webSocketApi: pushApi, stageName: 'live', autoDeploy: true });
    pushFn.addEnvironment('CALLBACK_URL', pushStage.callbackUrl);
    pushApi.grantManageConnections(pushFn);
    elders.grantReadWriteData(pushFn);
    calls.grant(pushFn, 'dynamodb:UpdateItem');
    pushFn.addEventSource(
      new DynamoEventSource(calls, { startingPosition: lambda.StartingPosition.LATEST, batchSize: 10, retryAttempts: 2 }),
    );

    new cdk.CfnOutput(this, 'SettingsUrl', { value: settingsUrl.url });
    new cdk.CfnOutput(this, 'PushUrl', { value: pushStage.url });
    new cdk.CfnOutput(this, 'IngestFnName', { value: ingestFn.functionName });
    new cdk.CfnOutput(this, 'EldersTableName', { value: elders.tableName });
    new cdk.CfnOutput(this, 'CallsTableName', { value: calls.tableName });
  }
}
