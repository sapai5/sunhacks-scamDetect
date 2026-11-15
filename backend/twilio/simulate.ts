// Plays a test script into the bridge exactly like Twilio would: POST /voice, then a
// Media Streams WebSocket with 20 ms mu-law frames on both tracks, voiced by Amazon Polly.
// Start the bridge first with TWILIO_DRY_RUN=1, then:
//   npx tsx twilio/simulate.ts [script-name]
// Checks the Calls table at the end. Real Bedrock calls; alerts email the family.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import WebSocket from 'ws';
import { TEST_SCRIPTS } from '../scripts/test-scripts.js';
import { pcm16ToMulaw } from './audio.js';
import { loadConfig } from './config.js';

const cfg = await loadConfig();
const base = `http://localhost:${cfg.port}`;
const script = TEST_SCRIPTS.find((s) => s.name === (process.argv[2] ?? 'grandparent-scam'))!;
const polly = new PollyClient({ region: cfg.region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.region }));
const callSid = `CA${Date.now()}sim`;

async function tts(text: string, voice: 'Joey' | 'Ruth'): Promise<Uint8Array> {
  const r = await polly.send(
    new SynthesizeSpeechCommand({ Text: text, VoiceId: voice, Engine: 'neural', OutputFormat: 'pcm', SampleRate: '8000' }),
  );
  return pcm16ToMulaw(Buffer.from(await r.AudioStream!.transformToByteArray()));
}

// 1. The call arrives.
const twiml = await (
  await fetch(`${base}/voice`, { method: 'POST', body: new URLSearchParams({ CallSid: callSid, From: '+16025550147' }) })
).text();
const token = /name="token" value="([^"]+)"/.exec(twiml)?.[1];
if (!token) throw new Error(`no stream in TwiML: ${twiml}`);
console.log(`call ${callSid}: screened, streaming`);

// 2. Twilio opens the media stream.
const ws = new WebSocket(`${base.replace('http', 'ws')}/media`);
await new Promise((r) => ws.once('open', r));
ws.send(JSON.stringify({ event: 'connected' }));
ws.send(JSON.stringify({ event: 'start', start: { callSid, customParameters: { token, callSid } } }));

const SILENCE = new Uint8Array(160).fill(0xff); // 20 ms of mu-law silence
const frame = (track: 'inbound' | 'outbound', bytes: Uint8Array) =>
  ws.send(JSON.stringify({ event: 'media', media: { track, payload: Buffer.from(bytes).toString('base64') } }));

/** Real-time playback: 20 ms frames on both tracks, the speaker's audio on one and silence on the other. */
async function play(track: 'inbound' | 'outbound' | null, audio: Uint8Array) {
  const start = Date.now();
  for (let i = 0, n = 0; i < Math.max(audio.length, 1); i += 160, n++) {
    const chunk = track ? audio.subarray(i, i + 160) : SILENCE;
    const padded = chunk.length === 160 ? chunk : Uint8Array.from({ length: 160 }, (_, k) => chunk[k] ?? 0xff);
    frame('inbound', track === 'inbound' ? padded : SILENCE);
    frame('outbound', track === 'outbound' ? padded : SILENCE);
    const wait = start + (n + 1) * 20 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
const pause = (ms: number) => play(null, new Uint8Array(Math.floor((ms / 20) * 160)));

// 3. The conversation. Caller lines on the inbound track, elder lines on the outbound track.
for (const line of script.lines) {
  console.log(`  ${line.speaker}: ${line.text}`);
  await play(line.speaker === 'caller' ? 'inbound' : 'outbound', await tts(line.text, line.speaker === 'caller' ? 'Joey' : 'Ruth'));
  await pause(1500);
}
// 4. If the agent takes over, the scripted caller answers it (the agent's speech is muted in dry run).
// One agent turn is ~2 s reply delay + ~1.5 s Lambda + ~5 s of speech, so leave room before each reply.
for (const reply of script.agentReplies ?? []) {
  await pause(11_000);
  console.log(`  caller (to agent): ${reply}`);
  await play('inbound', await tts(reply, 'Joey'));
}
await pause(script.agentReplies?.length ? 15_000 : 5_000);
ws.send(JSON.stringify({ event: 'stop' }));
ws.close();

// 5. What did the backend record?
await new Promise((r) => setTimeout(r, 3000));
const { Item } = await ddb.send(new GetCommand({ TableName: cfg.callsTable, Key: { callId: callSid } }));
console.log('\nCalls table:', {
  sentences: Item?.utterances?.length,
  speakers: [...new Set((Item?.utterances ?? []).map((u: { speaker: string }) => u.speaker))],
  level: Item?.state?.level,
  risk: Item?.state?.risk,
  tactics: Item?.state?.tactics,
  familyAlerted: Item?.familyAlerted,
  agentStatus: Item?.agentStatus,
});
console.log(`expected: peak ${script.expectedPeak}, alert ${script.expectAlert}, agent ${script.expectedAgent}`);
process.exit(0);
