// Service interfaces the UI depends on. Each has an AWS implementation and a mock,
// chosen once in createServices(). Screens and the call controller never import
// an AWS SDK or a URL directly, so later stages (Cognito, API Gateway, a stored
// call history) swap in here without touching UI code.
import type { AnalyzeRequest, Level, RiskState, TranscribeCredentials } from '@contracts';
import type { ServiceMode } from '../config/env';

/** Scores the transcript so far. AWS: Analyze Lambda (Bedrock + rules + SNS). */
export interface AnalyzeClient {
  analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<RiskState>;
}

/** Issues short-lived creds for Transcribe streaming. AWS: Credentials Lambda (STS). */
export interface CredentialsClient {
  getTranscribeCredentials(): Promise<TranscribeCredentials>;
}

export interface TranscriptHandlers {
  /** Sentence in progress; replaced by the next partial or final. */
  onPartial(text: string): void;
  /** Finished sentence. */
  onFinal(text: string): void;
  onError(err: unknown): void;
  /** The source ran out of input on its own (demo scripts). */
  onEnd?(): void;
}

export type StopFn = () => void;

/** Anything that produces transcript text: the mic via Transcribe, or a demo script. */
export interface TranscriptSource {
  start(handlers: TranscriptHandlers): Promise<StopFn>;
}

export interface DemoScript {
  id: string;
  title: string;
  expectedPeak: Level;
  lines: readonly string[];
}

export interface Services {
  mode: ServiceMode;
  analyze: AnalyzeClient;
  credentials: CredentialsClient;
  /** False when the mic path can't work (mock mode has no Transcribe credentials). */
  micAvailable: boolean;
  createMicSource(): TranscriptSource;
  demoScripts: readonly DemoScript[];
  createScriptSource(scriptId: string): TranscriptSource;
}
