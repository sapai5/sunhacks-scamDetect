// Plays each test script line by line against the deployed Lambdas, carrying
// state exactly like the browser does, then runs the agent conversation if
// the call triggers a takeover.
// Usage: npm run scripts:run [-- <script-name>]
// Note: alerts publish to SNS, so the family email gets real messages.
import { readFileSync } from 'node:fs';
import type {
  AgentResponse,
  AgentStatus,
  AnalyzeRequest,
  Level,
  RiskState,
  Utterance,
  Verification,
} from '../../contracts/index.js';
import { TEST_SCRIPTS } from './test-scripts.js';

const outputs = JSON.parse(readFileSync(new URL('../cdk-outputs.json', import.meta.url), 'utf8')).ScamShieldStage1;
const ANALYZE_URL: string = process.env.ANALYZE_URL ?? outputs.AnalyzeUrl;
const AGENT_URL: string = process.env.AGENT_URL ?? outputs.AgentUrl;
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

async function post<T>(url: string, body: unknown): Promise<{ data: T; ms: number }> {
  const started = Date.now();
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return { data: (await res.json()) as T, ms: Date.now() - started };
}

const only = process.argv[2];
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
      const { data: s, ms } = await post<RiskState>(ANALYZE_URL, body);
      prevLevel = s.level;
      calmStreak = s.calmStreak;
      familyAlerted ||= s.familyAlerted;
      if (rank[s.level] > rank[peak]) peak = s.level;
      if (s.action === 'ask_verification' && script.verificationAnswer) verification = script.verificationAnswer;
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
      const { data: a, ms } = await post<AgentResponse>(AGENT_URL, { callId, elderId: 'e-01', utterances });
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

  const checks = [
    ['peak', peak, script.expectedPeak],
    ['alert', familyAlerted, script.expectAlert],
    ['agent', agentStatus, script.expectedAgent],
  ] as const;
  const bad = checks.filter(([, got, want]) => got !== want);
  if (bad.length) failures++;
  console.log(`  -> peak ${peak}, alert ${familyAlerted}, agent ${agentStatus}: ${bad.length ? `FAIL (${bad.map((b) => b[0]).join(', ')})` : 'PASS'}`);
}

process.exit(failures ? 1 : 0);
