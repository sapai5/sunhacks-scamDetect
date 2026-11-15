import type { TranscribeCredentials } from '@contracts';
import { postJson } from '../http';
import type { CredentialsClient } from '../types';

/** Credentials Lambda function URL (STS AssumeRole, Transcribe streaming only). */
export function createAwsCredentialsClient(credentialsUrl: string): CredentialsClient {
  return {
    async getTranscribeCredentials() {
      const c = await postJson<TranscribeCredentials>(credentialsUrl, undefined, { timeoutMs: 8_000 });
      if (!c.accessKeyId || !c.secretAccessKey || !c.sessionToken) throw new Error('credentials response is incomplete');
      return c;
    },
  };
}

/** Mock mode has no AWS account behind it, so the live mic can't be used. */
export function createMockCredentialsClient(): CredentialsClient {
  return {
    getTranscribeCredentials: () =>
      Promise.reject(new Error('Live listening needs the AWS backend. Deploy it, or use a demo call.')),
  };
}
