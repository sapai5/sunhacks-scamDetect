// Lambda-free mode (LOCAL_BACKEND=1): the bridge runs IngestFn's and the Agent Lambda's own code in
// this process instead of invoking them. Same scoring, guards, Calls table writes and family emails;
// only AWS Lambda is out of the path. The app doesn't update in this mode: its push socket is a Lambda.
import { readFileSync } from 'node:fs';
import type { AgentRequest, AgentResponse, IngestRequest, RiskState } from '../../contracts/index.js';
import type { BridgeConfig } from './config.js';

export interface LocalBackend {
  ingest(req: IngestRequest): Promise<RiskState | null>;
  agent(req: AgentRequest): Promise<AgentResponse>;
}

export async function loadLocalBackend(cfg: BridgeConfig): Promise<LocalBackend> {
  // The environment CDK gives the Lambdas, set before their modules load (they read it at import).
  const ctx = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')).context as Record<string, string>;
  Object.assign(process.env, {
    AWS_REGION: cfg.region,
    MODEL_ID: ctx.modelId,
    CALLS_TABLE: cfg.callsTable,
    ELDERS_TABLE: cfg.eldersTable,
    FAMILY_TOPIC_ARN: cfg.familyTopicArn,
    ELDER_NAME: ctx.elderName,
    AGENT_NAME: ctx.agentName,
    AGENT_RELATION: ctx.agentRelation,
    VERIFICATION_QUESTION: ctx.verificationQuestion,
    VERIFICATION_ANSWER: ctx.verificationAnswer,
  });
  const { handler: ingest } = await import('../lambda/ingest/index.js');
  const { handler: agent } = await import('../lambda/agent/index.js');
  return {
    ingest,
    async agent(req) {
      const res = (await agent({ body: JSON.stringify(req) } as Parameters<typeof agent>[0])) as { statusCode: number; body: string };
      if (res.statusCode !== 200) throw new Error(`agent ${res.statusCode}: ${res.body}`);
      return JSON.parse(res.body) as AgentResponse;
    },
  };
}
