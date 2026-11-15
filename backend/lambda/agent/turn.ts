// One agent turn, shared by the Agent Lambda (browser calls) and IngestFn (phone calls).
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { AgentResponse, ElderSettings, Utterance } from '../../../contracts/index.js';
import { askClaude } from '../shared/bedrock.js';
import { systemPrompt, userMessage } from './prompt.js';
import { parseAgentReply } from './rules.js';

const sns = new SNSClient({});
const MODEL_ID = process.env.MODEL_ID!;
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;

type Reply = Pick<AgentResponse, 'say' | 'status' | 'summary'>;

const FAMILY_HEADLINE: Record<string, string> = {
  verified: 'The caller passed the check and the call was handed back.',
  scam_confirmed: 'The caller failed the check. We told them goodbye; please call her now.',
  caller_left: 'The caller hung up after the takeover.',
};

/** The agent's next line and status for the transcript so far. Throws if Bedrock fails. */
export async function agentReply(utterances: Utterance[], persona: ElderSettings): Promise<Reply> {
  // Last 60 lines is plenty: the scam lead-up plus the agent conversation.
  const recent = [...utterances].sort((a, b) => a.seq - b.seq).slice(-60);
  return parseAgentReply(await askClaude(MODEL_ID, systemPrompt(persona), userMessage(recent), 250), utterances, persona.verificationAnswer);
}

/** Email the family how the takeover ended. Returns false if SNS failed. */
export async function notifyFamily(persona: ElderSettings, reply: Reply): Promise<boolean> {
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: FAMILY_TOPIC_ARN,
        Subject: `Scam Shield: update on ${persona.elderName}'s call`,
        Message: `Scam Shield took over ${persona.elderName}'s call as ${persona.agentName}. ${FAMILY_HEADLINE[reply.status] ?? ''} ${reply.summary}`,
      }),
    );
    return true;
  } catch (err) {
    console.error('sns publish failed', err);
    return false;
  }
}
