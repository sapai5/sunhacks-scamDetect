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
 * Nova Sonic takeover: what Twilio's <Connect><Stream> does on both legs. The caller and the elder each
 * get a two-way stream (/agent); the bridge mixes them into a three-way call with the agent. Each
 * scripted line is spoken once the agent has finished talking: the caller's replies, with one line from
 * the elder after the first. After the last one everybody stays silent.
 */
async function talkToSonicAgent(replies: string[]) {
  for (let i = 0; i < 40; i++) {
    const { Item } = await ddb.send(new GetCommand({ TableName: cfg.callsTable, Key: { callId: callSid }, ProjectionExpression: 'agentStatus' }));
    if (Item?.agentStatus === 'active') break;
    if (i === 39) return console.log('  (no takeover within 20 s)');
    await pause(500);
  }
  await pause(1000);
  const elderLine = process.env.SIM_ELDER_LINE ?? "I'd like to hear that too. Go on, answer the question.";
  const turns: { who: 'caller' | 'elder'; text: string; audio: Uint8Array }[] = await Promise.all(
    replies.map(async (text) => ({ who: 'caller' as const, text, audio: await tts(text, 'Joey') })),
  );
  turns.splice(1, 0, { who: 'elder', text: elderLine, audio: await tts(elderLine, 'Ruth') });

  let agentSpoke = true; // the opening line (Twilio <Say>) was just said
  let lastAgentAudio = 0;
  let speaking: 'caller' | 'elder' | undefined;
  const open = async (leg: 'caller' | 'elder') => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/agent`);
    await new Promise((r) => sock.once('open', r));
    sock.send(JSON.stringify({ event: 'connected' }));
    sock.send(JSON.stringify({ event: 'start', streamSid: `MZ${leg}`, start: { streamSid: `MZ${leg}`, callSid, customParameters: { token, callSid, leg } } }));
    const state = { sock, closed: false, heardMs: 0 };
    sock.on('close', () => (state.closed = true));
    sock.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { event: string; media?: { payload: string } };
      if (m.event !== 'media' || !m.media) return;
      const bytes = Buffer.from(m.media.payload, 'base64');
      if (bytes.every((x) => x === 0xff || x === 0x7f)) return; // silence
      state.heardMs += bytes.length / 8; // 8 mu-law bytes per ms
      // Sound on the caller's leg while neither person is talking is the agent.
      if (leg === 'caller' && !speaking) {
        agentSpoke = true;
        lastAgentAudio = Date.now();
      }
    });
    return state;
  };
  const legs = { caller: await open('caller'), elder: await open('elder') };

  let turn: (typeof turns)[number] | undefined;
  let pos = 0;
  let quietSince = 0;
  const start = Date.now();
  // Until the bridge hangs up on the caller, or 20 s after the last line (verified: the two keep talking).
  for (let n = 1; !legs.caller.closed && Date.now() - start < 150_000 && (turns.length || turn || Date.now() - quietSince < 20_000); n++) {
    // The person who just spoke comes back through the bridge for a moment: wait before listening for the agent.
    if (!turn && speaking && Date.now() - quietSince > 300) speaking = undefined;
    if (!turn && !speaking && agentSpoke && Date.now() > lastAgentAudio + 800 && turns.length) {
      turn = turns.shift()!;
      speaking = turn.who;
      console.log(`  ${turn.who} (on the three-way call): ${turn.text}`);
      pos = 0;
      agentSpoke = false;
    }
    let chunk = SILENCE;
    if (turn) {
      chunk = Uint8Array.from({ length: 160 }, (_, k) => turn!.audio[pos + k] ?? 0xff);
      pos += 160;
      if (pos >= turn.audio.length) {
        turn = undefined;
        quietSince = Date.now();
      }
    }
    for (const leg of ['caller', 'elder'] as const) {
      if (legs[leg].closed) continue;
      const payload = Buffer.from(speaking === leg && chunk !== SILENCE ? chunk : SILENCE).toString('base64');
      legs[leg].sock.send(JSON.stringify({ event: 'media', streamSid: `MZ${leg}`, media: { track: 'inbound', payload } }));
    }
    frame('inbound', SILENCE); // the monitoring stream keeps running, like on a real call
    frame('outbound', SILENCE);
    const wait = start + n * 20 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  console.log(
    `  caller's stream ${legs.caller.closed ? 'closed by the bridge' : 'still open'}, elder's ${legs.elder.closed ? 'closed' : 'open'}; ` +
      `the caller heard ${(legs.caller.heardMs / 1000).toFixed(1)} s of sound (agent + elder), the elder ${(legs.elder.heardMs / 1000).toFixed(1)} s (agent + caller)`,
  );
  legs.caller.sock.close();
  legs.elder.sock.close();
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
