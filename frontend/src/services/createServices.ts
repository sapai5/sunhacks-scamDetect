// The one place that decides AWS vs mock. Add new backends (Cognito auth, a call
// history API, push notifications) as another client on Services and wire it here.
import { TEST_SCRIPTS } from '@backend/scripts/test-scripts';
import type { AppConfig } from '../config/env';
import { createAwsAnalyzeClient } from './analyze/awsAnalyzeClient';
import { createMockAnalyzeClient } from './analyze/mockAnalyzeClient';
import { createAwsCredentialsClient, createMockCredentialsClient } from './credentials/credentialsClients';
import { createScriptSource } from './transcription/scriptSource';
import type { CredentialsClient, DemoScript, Services, TranscriptSource } from './types';

/** Loads the Transcribe SDK (most of the bundle) only when live listening starts. */
const lazyMicSource = (credentials: CredentialsClient, region: string): TranscriptSource => ({
  async start(handlers) {
    const { createAwsTranscribeSource } = await import('./transcription/awsTranscribeSource');
    return createAwsTranscribeSource(credentials, region).start(handlers);
  },
});

const titleCase = (id: string) => id.replace(/-legit$/, ' (real call)').replaceAll('-', ' ').replace(/^\w/, (c) => c.toUpperCase());

export const DEMO_SCRIPTS: readonly DemoScript[] = TEST_SCRIPTS.map((s) => ({
  id: s.name,
  title: titleCase(s.name),
  expectedPeak: s.expectedPeak,
  lines: s.lines,
}));

export function createServices(config: AppConfig): Services {
  const aws = config.mode === 'aws';
  const analyze = aws ? createAwsAnalyzeClient(config.analyzeUrl) : createMockAnalyzeClient();
  const credentials = aws ? createAwsCredentialsClient(config.credentialsUrl) : createMockCredentialsClient();

  return {
    mode: config.mode,
    analyze,
    credentials,
    micAvailable: aws,
    createMicSource: () => lazyMicSource(credentials, config.region),
    demoScripts: DEMO_SCRIPTS,
    createScriptSource(scriptId) {
      const script = DEMO_SCRIPTS.find((s) => s.id === scriptId);
      if (!script) throw new Error(`Unknown demo script: ${scriptId}`);
      return createScriptSource(script.lines);
    },
  };
}
