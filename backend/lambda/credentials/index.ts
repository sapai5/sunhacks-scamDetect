import { randomUUID } from 'node:crypto';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { TranscribeCredentials } from '../../../contracts/index.js';

const sts = new STSClient({});
const ROLE_ARN = process.env.TRANSCRIBE_ROLE_ARN!;

export const handler = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const { Credentials: c } = await sts.send(
      new AssumeRoleCommand({
        RoleArn: ROLE_ARN,
        RoleSessionName: `browser-${randomUUID().slice(0, 8)}`,
        DurationSeconds: 900, // STS minimum. Only needed to open the socket.
      }),
    );
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error('No credentials returned');
    const body: TranscribeCredentials = {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration?.toISOString(),
      region: process.env.AWS_REGION,
    };
    return json(200, body);
  } catch (err) {
    console.error('assume role failed', err);
    return json(500, { error: 'could not issue credentials' });
  }
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});
