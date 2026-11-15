// Plays each test script line by line against the deployed Analyze Lambda,
// carrying state exactly like the browser does, and checks the peak level.
// Usage: npm run scripts:run [-- <script-name>]
// Note: red results publish to SNS, so the family number will get texts.
import { readFileSync } from 'node:fs';
import type { AnalyzeRequest, Level, RiskState, Utterance, Verification } from '../../contracts/index.js';
import { TEST_SCRIPTS } from './test-scripts.js';

const outputs = JSON.parse(readFileSync(new URL('../cdk-outputs.json', import.meta.url), 'utf8'));
const ANALYZE_URL: string = process.env.ANALYZE_URL ?? outputs.ScamShieldStage1.AnalyzeUrl;
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

const only = process.argv[2];
let failures = 0;

for (const script of TEST_SCRIPTS.filter((s) => !only || s.name === only)) {
  const callId = `test-${script.name}-${Date.now()}`;
  const utterances: Utterance[] = [];
  let prevLevel: Level = 'green';
  let calmStreak = 0;
  let verification: Verification = 'unasked';
  let peak: Level = 'green';
  const t0 = Date.now();

  console.log(`\n=== ${script.name} (expect peak ${script.expectedPeak})`);
  for (const [i, text] of script.lines.entries()) {
    utterances.push({ callId, elderId: 'e-01', speaker: 'caller', text, ts: t0 + i * 5000, seq: i });
    const body: AnalyzeRequest = { callId, elderId: 'e-01', utterances, prevLevel, calmStreak, verification };
    const started = Date.now();
    const res = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      console.log(`  ${i}: HTTP ${res.status} ${await res.text()}`);
      failures++;
      continue;
    }
    const s = (await res.json()) as RiskState;
    prevLevel = s.level;
    calmStreak = s.calmStreak;
    if (rank[s.level] > rank[peak]) peak = s.level;
    if (s.action === 'ask_verification' && script.verificationAnswer) verification = script.verificationAnswer;
    console.log(
      `  ${i}: ${s.level.padEnd(6)} risk=${String(s.risk).padStart(3)} ${ms}ms [${s.tactics.join(',')}] ${s.action}${s.familyAlerted ? ' ALERT SENT' : ''}  "${text.slice(0, 50)}"`,
    );
  }
  const ok = peak === script.expectedPeak;
  if (!ok) failures++;
  console.log(`  -> peak ${peak} ${ok ? 'PASS' : 'FAIL'}`);
}

process.exit(failures ? 1 : 0);
