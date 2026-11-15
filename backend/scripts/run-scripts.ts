// Plays each test script line by line against the deployed Lambdas, carrying
// state exactly like the browser does, then runs the agent conversation if
// the call triggers a takeover.
// Usage: npm run scripts:run -- [<script-name>] [--ingest | --local]
//   --ingest  sends each line to IngestFn (phone path, state in the Calls table) instead of the
//             Analyze URL (browser path, state carried here); levels should match.
//   --local   runs the Lambdas' scoring and agent code in this process against Bedrock, with the
//             settings from cdk.json and no SNS. For prompt tuning: no deploy, no emails.
// Note: without --local, alerts publish to SNS, so the family email gets real messages.
import { existsSync, readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type {
  AgentResponse,
  AgentStatus,
  AnalyzeRequest,
  IngestRequest,
  Level,
  RiskState,
  Utterance,
  Verification,
} from '../../contracts/index.js';
import { TEST_SCRIPTS, type Line } from './test-scripts.js';

const args = process.argv.slice(2);
const INGEST = args.includes('--ingest');
const LOCAL = args.includes('--local');
const only = args.find((a) => !a.startsWith('--'));

const outputsFile = new URL('../cdk-outputs.json', import.meta.url);
const allOutputs = existsSync(outputsFile) ? JSON.parse(readFileSync(outputsFile, 'utf8')) : {};
const outputs = allOutputs.ScamShieldStage1 ?? {};
const data = allOutputs.ScamShieldData ?? {};
const ANALYZE_URL: string = process.env.ANALYZE_URL ?? outputs.AnalyzeUrl;
const AGENT_URL: string = process.env.AGENT_URL ?? outputs.AgentUrl;
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

if (INGEST && !data.IngestFnName) throw new Error('--ingest needs the ScamShieldData stack in cdk-outputs.json (npm run deploy)');
if (!LOCAL && !ANALYZE_URL) throw new Error('no cdk-outputs.json: run npm run deploy, or use --local');
if (LOCAL) {
  // The env the Lambdas get from CDK, set before their modules are imported below.
  const c = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')).context;
  Object.assign(process.env, {
    AWS_REGION: c.region,
    MODEL_ID: c.modelId,
    ELDER_NAME: c.elderName,
    VERIFICATION_QUESTION: c.verificationQuestion,
    VERIFICATION_ANSWER: c.verificationAnswer,
    AGENT_NAME: c.agentName,
    AGENT_RELATION: c.agentRelation,
  });
}

async function timed<T>(work: Promise<T>): Promise<{ data: T; ms: number }> {
  const started = Date.now();
  return { data: await work, ms: Date.now() - started };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const lambdaClient = new LambdaClient({ region: outputs.Region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: outputs.Region }));

/** One script line through the chosen path. */
async function analyzeLine(body: AnalyzeRequest, line: Line, ts: number): Promise<RiskState> {
  if (INGEST) {
    const req: IngestRequest = { ...body.utterances[body.utterances.length - 1], speaker: line.speaker, ts };
    const res = await lambdaClient.send(new InvokeCommand({ FunctionName: data.IngestFnName, Payload: JSON.stringify(req) }));
    const text = new TextDecoder().decode(res.Payload);
    if (res.FunctionError) throw new Error(`ingest: ${text}`);
    return JSON.parse(text) as RiskState;
  }
  if (!LOCAL) return post<RiskState>(ANALYZE_URL, body);
  const { score } = await import('../lambda/analyze/score.js');
  const { loadElder } = await import('../lambda/shared/db.js');
  const { state, shouldAlert } = await score(body, await loadElder(body.elderId));
  state.familyAlerted = shouldAlert; // would have been sent
  return state;
}

/** One agent turn: the deployed Agent Lambda, or (--local) its core without the SNS summary. */
async function agentTurn(callId: string, utterances: Utterance[]): Promise<AgentResponse> {
  if (!LOCAL) return post<AgentResponse>(AGENT_URL, { callId, elderId: 'e-01', utterances });
  const { askClaude } = await import('../lambda/shared/bedrock.js');
  const { systemPrompt, userMessage } = await import('../lambda/agent/prompt.js');
  const { parseAgentReply } = await import('../lambda/agent/rules.js');
  const { loadElder } = await import('../lambda/shared/db.js');
  const p = await loadElder('e-01');
  const reply = await askClaude(process.env.MODEL_ID!, systemPrompt(p), userMessage(utterances.slice(-60)), 250);
  return { callId, ...parseAgentReply(reply, utterances, p.verificationAnswer), familyNotified: false };
}

let failures = 0;

for (const script of TEST_SCRIPTS.filter((s) => !only || s.name === only)) {
  const callId = `test-${script.name}-${Date.now()}`;
  const utterances: Utterance[] = [];
  let prevLevel: Level = 'green';
  let calmStreak = 0;
  let verification: Verification = 'unasked';
  let familyAlerted = false;
  let agentStatus: AgentStatus = 'idle';
  let peak: Level = 'green';
  let t = Date.now();
  const add = (speaker: string, text: string) => {
    t += 4000;
    utterances.push({ callId, elderId: 'e-01', speaker, text, ts: t, seq: utterances.length });
  };

  console.log(`\n=== ${script.name} (expect peak ${script.expectedPeak}, alert ${script.expectAlert}, agent ${script.expectedAgent})`);
  for (const line of script.lines) {
    if (agentStatus === 'active') break;
    add(line.speaker, line.text);
    const body: AnalyzeRequest = { callId, elderId: 'e-01', utterances, prevLevel, calmStreak, verification, familyAlerted, agentStatus };
    try {
      const { data: s, ms } = await timed(analyzeLine(body, line, t));
      prevLevel = s.level;
      calmStreak = s.calmStreak;
      familyAlerted ||= s.familyAlerted;
      if (rank[s.level] > rank[peak]) peak = s.level;
      if (s.action === 'ask_verification' && script.verificationAnswer) {
        verification = script.verificationAnswer;
        // The elder's tap on the phone path: there's no app endpoint for it yet, so write it directly.
        if (INGEST) {
          await ddb.send(
            new UpdateCommand({
              TableName: data.CallsTableName,
              Key: { callId },
              UpdateExpression: 'SET verification = :v',
              ExpressionAttributeValues: { ':v': verification },
            }),
          );
        }
      }
      if (s.action === 'agent_takeover') agentStatus = 'active';
      console.log(
        `  ${line.speaker.padEnd(6)} ${s.level.padEnd(6)} risk=${String(s.risk).padStart(3)} elder=${s.elderState.padEnd(9)} ${String(ms).padStart(4)}ms [${s.tactics.join(',')}] ${s.action}${s.familyAlerted ? ' ALERT SENT' : ''}  "${line.text.slice(0, 45)}"`,
      );
    } catch (err) {
      console.log(`  ${line.speaker} ${String(err)}`);
      failures++;
    }
  }

  // Agent conversation: agent speaks, the scripted caller replies, repeat.
  const replies = [...(script.agentReplies ?? [])];
  while (agentStatus === 'active') {
    try {
      const { data: a, ms } = await timed(agentTurn(callId, utterances));
      if (a.say) add('agent', a.say);
      agentStatus = a.status;
      console.log(`  AGENT  ${a.status.padEnd(14)} ${String(ms).padStart(4)}ms${a.familyNotified ? ' FAMILY UPDATED' : ''}  "${a.say}"`);
      if (a.status !== 'active') {
        console.log(`         summary: ${a.summary}`);
        break;
      }
      const reply = replies.shift();
      if (!reply) {
        console.log('  (script out of caller replies, treating as caller left)');
        agentStatus = 'caller_left';
        break;
      }
      add('caller', reply);
      console.log(`  caller                  "${reply.slice(0, 70)}"`);
    } catch (err) {
      console.log(`  AGENT ${String(err)}`);
      failures++;
      break;
    }
  }

  // Scam scripts must reach red; the others must not go above their expected peak.
  const peakOk = script.expectedPeak === 'red' ? peak === 'red' : rank[peak] <= rank[script.expectedPeak];
  const bad = [
    !peakOk && 'peak',
    familyAlerted !== script.expectAlert && 'alert',
    agentStatus !== script.expectedAgent && 'agent',
  ].filter(Boolean);
  if (bad.length) failures++;
  console.log(`  -> peak ${peak}, alert ${familyAlerted}, agent ${agentStatus}: ${bad.length ? `FAIL (${bad.join(', ')})` : 'PASS'}`);
}

process.exit(failures ? 1 : 0);
