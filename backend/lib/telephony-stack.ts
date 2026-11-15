import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface TelephonyStackProps extends cdk.StackProps {
  /** E.164 number of the elder's real phone; protected calls are transferred here. */
  elderPhone: string;
  /** Comma-separated E.164 numbers that skip screening (until B1 moves this to DynamoDB). */
  trustedContacts: string;
  /** Optional area code prefix for the protected number, e.g. "+1480". Unset = any US number. */
  numberPrefix?: string;
  /** Hours Kinesis Video Streams keeps call audio. 0 = no retention (only ~5 min readable). */
  audioRetentionHours: number;
  /** false = only the instance, storage and Lambda (used while debugging the flow and number). */
  withCallPath: boolean;
}

/**
 * Stage 2 call path (Track A):
 * caller -> Connect number -> contacts check -> (unknown) start media streaming -> transfer to the elder's phone.
 */
export class TelephonyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TelephonyStackProps) {
    super(scope, id, props);

    const instance = new connect.CfnInstance(this, 'Instance', {
      instanceAlias: `scamshield-${this.account}`,
      identityManagementType: 'CONNECT_MANAGED',
      attributes: {
        inboundCalls: true,
        outboundCalls: false,
        contactflowLogs: true,
        // Privacy: no recordings or analytics stored by Connect.
        contactLens: false,
        autoResolveBestVoices: true,
      },
    });

    // Live media streaming: Connect writes each call's audio to its own KVS stream.
    const audioKey = new kms.Key(this, 'CallAudioKey', {
      description: 'Encrypts live call audio in Kinesis Video Streams',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new connect.CfnInstanceStorageConfig(this, 'MediaStreams', {
      instanceArn: instance.attrArn,
      resourceType: 'MEDIA_STREAMS',
      storageType: 'KINESIS_VIDEO_STREAM',
      kinesisVideoStreamConfig: {
        prefix: 'scamshield',
        retentionPeriodHours: props.audioRetentionHours,
        encryptionConfig: { encryptionType: 'KMS', keyId: audioKey.keyArn },
      },
    });

    // Contacts check: known numbers ring straight through without streaming.
    const contactsCheckFn = new NodejsFunction(this, 'ContactsCheckFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(here, '../telephony/contacts-check/index.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(3),
      environment: { TRUSTED_CONTACTS: props.trustedContacts },
      bundling: { minify: true, sourceMap: true },
      logGroup: new logs.LogGroup(this, 'ContactsCheckLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    contactsCheckFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: instance.attrArn,
      sourceAccount: this.account,
    });
    new connect.CfnIntegrationAssociation(this, 'ContactsCheckAssociation', {
      instanceId: instance.attrArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: contactsCheckFn.functionArn,
    });

    new cdk.CfnOutput(this, 'ConnectInstanceId', { value: instance.attrId });
    new cdk.CfnOutput(this, 'ContactsCheckFnArn', { value: contactsCheckFn.functionArn });
    if (!props.withCallPath) return;

    const flow = new connect.CfnContactFlow(this, 'ProtectedFlow', {
      instanceArn: instance.attrArn,
      name: 'Call Me Maybe... NOT protected number',
      type: 'CONTACT_FLOW',
      description: 'Contacts check, then live media streaming for unknown callers, then transfer to the elder.',
      content: this.toJsonString(protectedFlow(contactsCheckFn.functionArn, props.elderPhone)),
    });

    const number = new connect.CfnPhoneNumber(this, 'ProtectedNumber', {
      targetArn: instance.attrArn,
      countryCode: 'US',
      type: 'DID',
      prefix: props.numberPrefix,
      description: 'Call Me Maybe... NOT protected number',
    });

    // CloudFormation can't point a number at a flow, so call the API directly.
    const lastSegment = (arn: string) => cdk.Fn.select(1, cdk.Fn.split('/', arn));
    const flowId = cdk.Fn.select(3, cdk.Fn.split('/', flow.attrContactFlowArn));
    new cr.AwsCustomResource(this, 'NumberToFlow', {
      onUpdate: {
        service: 'Connect',
        action: 'AssociatePhoneNumberContactFlow',
        parameters: { InstanceId: instance.attrId, PhoneNumberId: lastSegment(number.attrPhoneNumberArn), ContactFlowId: flowId },
        physicalResourceId: cr.PhysicalResourceId.of(`${number.logicalId}-flow`),
      },
      onDelete: {
        service: 'Connect',
        action: 'DisassociatePhoneNumberContactFlow',
        parameters: { InstanceId: instance.attrId, PhoneNumberId: lastSegment(number.attrPhoneNumberArn) },
        ignoreErrorCodesMatching: 'ResourceNotFoundException',
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });

    new cdk.CfnOutput(this, 'ProtectedPhoneNumber', { value: number.attrAddress });
  }
}

/** Flow language JSON. Block ids are fixed so redeploys don't reshuffle the flow. */
export function protectedFlow(contactsCheckArn: string, elderPhone: string) {
  const id = {
    check: 'a1000000-0000-4000-8000-000000000001',
    compare: 'a1000000-0000-4000-8000-000000000002',
    stream: 'a1000000-0000-4000-8000-000000000003',
    transfer: 'a1000000-0000-4000-8000-000000000004',
    error: 'a1000000-0000-4000-8000-000000000005',
    disconnect: 'a1000000-0000-4000-8000-000000000006',
  };
  const transfer = {
    Identifier: id.transfer,
    Type: 'TransferParticipantToThirdParty',
    Parameters: { ThirdPartyPhoneNumber: elderPhone, ThirdPartyConnectionTimeLimitSeconds: '30', ContinueFlowExecution: 'False' },
    Transitions: {
      NextAction: id.disconnect,
      // Only NoMatchingError is valid on this action (CallFailed etc. are rejected by Connect).
      Errors: [{ NextAction: id.error, ErrorType: 'NoMatchingError' }],
    },
  };
  return {
    Version: '2019-10-30',
    StartAction: id.check,
    Metadata: {
      EntryPointPosition: { x: 40, y: 40 },
      ActionMetadata: {
        [id.check]: { position: { x: 160, y: 40 } },
        [id.compare]: { position: { x: 400, y: 40 } },
        [id.stream]: { position: { x: 640, y: 160 } },
        [id.transfer]: { position: { x: 880, y: 40 } },
        [id.error]: { position: { x: 1120, y: 160 } },
        [id.disconnect]: { position: { x: 1360, y: 40 } },
      },
    },
    Actions: [
      {
        // Contacts check. If the Lambda fails, screen the call (fail safe).
        Identifier: id.check,
        Type: 'InvokeLambdaFunction',
        Parameters: { LambdaFunctionARN: contactsCheckArn, InvocationTimeLimitSeconds: '3', ResponseValidation: { ResponseType: 'STRING_MAP' } },
        Transitions: { NextAction: id.compare, Errors: [{ NextAction: id.stream, ErrorType: 'NoMatchingError' }] },
      },
      {
        Identifier: id.compare,
        Type: 'Compare',
        Parameters: { ComparisonValue: '$.External.trusted' },
        Transitions: {
          NextAction: id.stream,
          Conditions: [{ NextAction: id.transfer, Condition: { Operator: 'Equals', Operands: ['true'] } }],
          Errors: [{ NextAction: id.stream, ErrorType: 'NoMatchingCondition' }],
        },
      },
      {
        // Unknown caller: stream both directions of the customer leg.
        Identifier: id.stream,
        Type: 'UpdateContactMediaStreamingBehavior',
        Parameters: {
          MediaStreamingState: 'Enabled',
          MediaStreamType: 'Audio',
          Participants: [{ ParticipantType: 'Customer', MediaDirections: ['To', 'From'] }],
        },
        Transitions: { NextAction: id.transfer, Errors: [{ NextAction: id.transfer, ErrorType: 'NoMatchingError' }] },
      },
      transfer,
      {
        Identifier: id.error,
        Type: 'MessageParticipant',
        Parameters: { Text: "Sorry, we couldn't connect your call. Please try again later." },
        Transitions: { NextAction: id.disconnect, Errors: [{ NextAction: id.disconnect, ErrorType: 'NoMatchingError' }] },
      },
      { Identifier: id.disconnect, Type: 'DisconnectParticipant', Parameters: {}, Transitions: {} },
    ],
  };
}
