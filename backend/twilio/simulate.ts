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
// 4. If the agent takes over, the scripted caller answers it.
if (script.agentReplies?.length && cfg.agentVoice === 'sonic') {
  await talkToSonicAgent(script.agentReplies);
  await pause(8000); // the closing line, then the bridge saves the outcome
} else {
  // <Say> path (the agent's speech is muted in dry run). One agent turn is ~2 s reply delay
  // + ~1.5 s Lambda + ~5 s of speech, so leave room before each reply.
  for (const reply of script.agentReplies ?? []) {
    await pause(11_000);
    console.log(`  caller (to agent): ${reply}`);
    await play('inbound', await tts(reply, 'Joey'));
  }
  await pause(script.agentReplies?.length ? 15_000 : 5_000);
}
ws.send(JSON.stringify({ event: 'stop' }));
ws.close();

/**
 * Nova Sonic takeover: what Twilio's <Connect><Stream> does after the redirect. The caller's voice goes
 * up a second, two-way stream (/agent) and the agent's voice comes back on it. Each scripted reply is
 * spoken once the agent has finished talking; after the last one the caller stays silent.
 */
async function talkToSonicAgent(replies: string[]) {
  for (let i = 0; i < 40; i++) {
    const { Item } = await ddb.send(new GetCommand({ TableName: cfg.callsTable, Key: { callId: callSid }, ProjectionExpression: 'agentStatus' }));
    if (Item?.agentStatus === 'active') break;
    if (i === 39) return console.log('  (no takeover within 20 s)');
    await pause(500);
  }
  await pause(1000);
  const speeches = await Promise.all(replies.map((r) => tts(r, 'Joey')));
  const agent = new WebSocket(`${base.replace('http', 'ws')}/agent`);
  await new Promise((r) => agent.once('open', r));
  agent.send(JSON.stringify({ event: 'connected' }));
  agent.send(JSON.stringify({ event: 'start', streamSid: 'MZsim', start: { streamSid: 'MZsim', callSid, customParameters: { token, callSid } } }));
  let closed = false;
  let playingUntil = 0; // when the agent's audio received so far finishes playing
  let heardMs = 0;
  let agentSpoke = true; // the opening line (Twilio <Say>) was just said
  agent.on('close', () => (closed = true));
  agent.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as { event: string; media?: { payload: string } };
    if (m.event === 'media' && m.media) {
      const ms = Buffer.from(m.media.payload, 'base64').length / 8; // 8 mu-law bytes per ms
      playingUntil = Math.max(Date.now(), playingUntil) + ms;
      heardMs += ms;
      agentSpoke = true;
    } else if (m.event === 'clear') {
      playingUntil = Date.now(); // we talked over the agent
    }
  });

  let speech: Uint8Array | undefined;
  let pos = 0;
  const start = Date.now();
  for (let n = 1; !closed && Date.now() - start < 150_000; n++) {
    if (!speech && agentSpoke && Date.now() > playingUntil + 800 && speeches.length) {
      console.log(`  caller (to agent): ${replies[replies.length - speeches.length]}`);
      speech = speeches.shift();
      pos = 0;
      agentSpoke = false;
    }
    let chunk = SILENCE;
    if (speech) {
      chunk = Uint8Array.from({ length: 160 }, (_, k) => speech![pos + k] ?? 0xff);
      pos += 160;
      if (pos >= speech.length) speech = undefined;
    }
    agent.send(JSON.stringify({ event: 'media', streamSid: 'MZsim', media: { track: 'inbound', payload: Buffer.from(chunk).toString('base64') } }));
    frame('inbound', SILENCE); // the monitoring stream keeps running, like on a real call
    frame('outbound', SILENCE);
    const wait = start + n * 20 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  console.log(`  agent stream ${closed ? 'closed by the bridge' : 'still open after 150 s'}; heard ${(heardMs / 1000).toFixed(1)} s of agent audio`);
  agent.close();
}

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
  agentSummary: Item?.agentSummary,
});
// The takeover conversation, from the agent's first line.
const lines = (Item?.utterances ?? []) as { speaker: string; text: string }[];
const takeover = lines.findIndex((u) => u.speaker === 'agent');
if (takeover >= 0) for (const u of lines.slice(takeover)) console.log(`  [${u.speaker}] ${u.text}`);
console.log(`expected: peak ${script.expectedPeak}, alert ${script.expectAlert}, agent ${script.expectedAgent}`);
process.exit(0);
