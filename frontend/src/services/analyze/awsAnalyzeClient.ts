import type { AnalyzeRequest, RiskState } from '@contracts';
import { postJson } from '../http';
import type { AnalyzeClient } from '../types';

/** Analyze Lambda function URL. Its own timeout is 15 s; give up a little earlier. */
export function createAwsAnalyzeClient(analyzeUrl: string): AnalyzeClient {
  return {
    analyze: (req: AnalyzeRequest, signal?: AbortSignal) => postJson<RiskState>(analyzeUrl, req, { timeoutMs: 12_000, signal }),
  };
}
