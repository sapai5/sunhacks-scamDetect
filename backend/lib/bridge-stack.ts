import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Secrets Manager secret (JSON) made by scripts/bridge-secret.ts before the first deploy. */
export const BRIDGE_SECRET_NAME = 'scamshield/bridge';
const SECRET_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_NUMBER', 'TWILIO_DIAL_FROM', 'ELDER_PHONE', 'TRUSTED_CONTACTS'];

export interface BridgeStackProps extends cdk.StackProps {
  /** Optional role (usually in another account) the bridge assumes for Amazon Transcribe only. */
  transcribeRoleArn?: string;
}

/**
 * The Twilio bridge on Fargate, replacing the laptop + Cloudflare tunnel.
 *   Twilio ──https / wss──> CloudFront ──http──> ALB (CloudFront only) ──> Fargate task (one container)
 * CloudFront gives the HTTPS and secure-WebSocket endpoint Twilio needs without a domain or certificate.
 * One task on purpose: each call's state lives in that process's memory.
 */
export class BridgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BridgeStackProps) {
    super(scope, id, props);

    // Public subnets only, no NAT gateway: the task gets a public IP for its outbound calls (Twilio, AWS).
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'Bridge ALB: CloudFront only' });
    const cloudfrontPrefixList = ec2.PrefixList.fromLookup(this, 'CloudFrontOrigins', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    albSg.addIngressRule(ec2.Peer.prefixList(cloudfrontPrefixList.prefixListId), ec2.Port.tcp(80), 'CloudFront');

    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', { vpc, description: 'Bridge task: ALB only' });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'ALB');

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      // Media Streams keep a WebSocket open for the whole call.
      idleTimeout: cdk.Duration.seconds(3600),
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Scam Shield Twilio bridge',
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          readTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Pass Twilio's signature header and the form body through untouched.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const publicUrl = `https://${distribution.distributionDomainName}`;

    const secret = secretsmanager.Secret.fromSecretNameV2(this, 'BridgeSecret', BRIDGE_SECRET_NAME);

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    taskDef.addContainer('bridge', {
      image: ecs.ContainerImage.fromAsset(path.join(here, '../..'), { file: 'backend/twilio/Dockerfile' }),
      portMappings: [{ containerPort: 8080 }],
      environment: {
        AWS_REGION: this.region,
        PORT: '8080',
        PUBLIC_URL: publicUrl,
        ...(props.transcribeRoleArn ? { TRANSCRIBE_ROLE_ARN: props.transcribeRoleArn } : {}),
      },
      secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, ecs.Secret.fromSecretsManager(secret, k)])),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bridge',
        logGroup: new logs.LogGroup(this, 'Logs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY }),
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'node -e "fetch(\'http://localhost:8080/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"'],
        interval: cdk.Duration.seconds(30),
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    // What the bridge calls. Scoped to our own stacks and tables.
    const role = taskDef.taskRole;
    const stackArn = (name: string) => `arn:aws:cloudformation:${this.region}:${this.account}:stack/${name}/*`;
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: [stackArn('ScamShieldStage1'), stackArn('ScamShieldData')] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [`arn:aws:lambda:${this.region}:${this.account}:function:ScamShieldData-IngestFn*`] }));
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/ScamShieldElders`, `arn:aws:dynamodb:${this.region}:${this.account}:table/ScamShieldData-Calls*`],
      }),
    );
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['transcribe:StartStreamTranscription', 'transcribe:StartStreamTranscriptionWebSocket'], resources: ['*'] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    // Nova Sonic (AGENT_VOICE=sonic) and the Lambda-free mode call Bedrock and SNS directly.
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithBidirectionalStream'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`],
      }),
    );
    role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], resources: [`arn:aws:sns:${this.region}:${this.account}:ScamShieldStage1-FamilyAlerts*`] }));
    if (props.transcribeRoleArn) {
      role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [props.transcribeRoleArn] }));
    }

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      // A call in progress lives in the task's memory: never run two at once.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [taskSg],
      circuitBreaker: { rollback: true },
    });

    const listener = alb.addListener('Http', { port: 80, open: false });
    listener.addTargets('Bridge', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/health', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: cdk.Duration.seconds(10),
    });

    new cdk.CfnOutput(this, 'BridgeUrl', { value: publicUrl, description: 'Set as PUBLIC_URL; Twilio webhooks are <url>/voice and <url>/status' });
    new cdk.CfnOutput(this, 'BridgeLogGroup', { value: `/aws/ecs ${this.stackName} (see Logs construct)` });
  }
}
