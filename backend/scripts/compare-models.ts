// Replays every test script through the Analyze prompt + level rules with several Bedrock models,
// locally (no deploy). Reports peak level / alert / takeover per script, and latency per call.
// Usage: npx tsx scripts/compare-models.ts [modelId ...]
// Costs a few cents per model (one Bedrock call per sentence).
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AgentStatus, Level, Utterance } from '../../contracts/index.js';
import { buildUserMessage, SYSTEM_PROMPT } from '../lambda/analyze/prompt.js';
import { decide, parseVerdict, recentWindow } from '../lambda/analyze/rules.js';
import { TEST_SCRIPTS } from './test-scripts.js';

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-5-20251101-v1:0'];
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

async function ask(modelId: string, user: string): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 200,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(res.body)) as { content?: { type: string; text?: string }[] };
  return { text: body.content?.find((c) => c.type === 'text')?.text ?? '', ms: Date.now() - t0 };
}

const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];

for (const modelId of MODELS) {
  const lat: number[] = [];
  let pass = 0;
  let errors = 0;
  const lines: string[] = [];
  for (const s of TEST_SCRIPTS) {
    const utterances: Utterance[] = [];
    let prevLevel: Level = 'green';
    let calmStreak = 0;
    let familyAlerted = false;
    let agentStatus: AgentStatus = 'idle';
    let peak: Level = 'green';
    let firstRed = -1;
    let t = Date.now();
    for (const [i, line] of s.lines.entries()) {
      if (agentStatus === 'active') break;
      t += 4000;
      utterances.push({ callId: 'cmp', elderId: 'sim', speaker: line.speaker, text: line.text, ts: t, seq: i });
      try {
        const { text, ms } = await ask(modelId, buildUserMessage('Rose', recentWindow(utterances)));
        lat.push(ms);
        const v = parseVerdict(text);
        const d = decide(v, { prevLevel, calmStreak, verification: 'unasked', familyAlerted, agentStatus });
        prevLevel = d.level;
        calmStreak = d.calmStreak;
        familyAlerted ||= d.shouldAlert;
        if (d.action === 'agent_takeover') agentStatus = 'active';
        if (rank[d.level] > rank[peak]) peak = d.level;
        if (d.level === 'red' && firstRed < 0) firstRed = i;
      } catch (err) {
        errors++;
        lines.push(`    ${s.name} line ${i}: ${(err as Error).name}: ${(err as Error).message.slice(0, 120)}`);
        break;
      }
    }
    const tookOver = agentStatus === 'active';
    const wantTakeover = s.expectedAgent !== 'idle';
    // Same rule as run-scripts: scams must reach red; for legit calls the expected peak is a ceiling.
    const peakOk = s.expectedPeak === 'red' ? peak === 'red' : rank[peak] <= rank[s.expectedPeak];
    const ok = peakOk && familyAlerted === s.expectAlert && tookOver === wantTakeover;
    if (ok) pass++;
    lines.push(
      `    ${ok ? 'PASS' : 'FAIL'} ${s.name.padEnd(28)} peak ${peak.padEnd(6)} alert ${String(familyAlerted).padEnd(5)} takeover ${String(tookOver).padEnd(5)}` +
        `${firstRed >= 0 ? ` red@line ${firstRed}` : ''}${ok ? '' : `  (want ${s.expectedPeak}/${s.expectAlert}/${wantTakeover})`}`,
    );
  }
  console.log(`\n${modelId}: ${pass}/${TEST_SCRIPTS.length} scripts pass, ${errors} errors`);
  if (lat.length) console.log(`  latency per call: median ${p(lat, 0.5)} ms, p90 ${p(lat, 0.9)} ms, max ${Math.max(...lat)} ms (${lat.length} calls)`);
  console.log(lines.join('\n'));
}
