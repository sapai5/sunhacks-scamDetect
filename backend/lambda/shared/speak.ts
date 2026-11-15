// Plays the phone agent's line into a live call. Track A provides the Lambda that does it (A4),
// invoked with { callId, text }. Until PHONE_SPEAK_FN is set, phone calls get no agent.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const SPEAK_FN = process.env.PHONE_SPEAK_FN;
const lambda = new LambdaClient({});

/** True once a way to speak into phone calls is configured ('log' counts: dry run, nothing is heard). */
export const PHONE_AGENT = Boolean(SPEAK_FN);

export async function speakIntoCall(callId: string, text: string): Promise<void> {
  if (SPEAK_FN === 'log') return void console.log(JSON.stringify({ callId, speak: text }));
  const res = await lambda.send(new InvokeCommand({ FunctionName: SPEAK_FN, Payload: JSON.stringify({ callId, text }) }));
  if (res.FunctionError) throw new Error(`speak failed: ${new TextDecoder().decode(res.Payload)}`);
}
