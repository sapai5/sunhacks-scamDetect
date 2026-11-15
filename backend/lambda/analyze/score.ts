// Scoring shared by the Analyze Lambda (browser calls) and IngestFn (phone calls):
// last ~60 s -> Bedrock -> level rules, plus the family alert.
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { AnalyzeRequest, ElderSettings, RiskState } from '../../../contracts/index.js';
import { detectExposures, exposureSentence, mergeExposures } from '../../../contracts/exposures.js';
import { askClaude } from '../shared/bedrock.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { decide, parseVerdict, recentWindow, type ModelVerdict } from './rules.js';

const sns = new SNSClient({});
const MODEL_ID = process.env.MODEL_ID!;
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;

const EMPTY: ModelVerdict = { risk: 0, tactics: [], reason: '', claimedRelative: false, elderState: 'none' };

/** Score the call so far. Throws if Bedrock fails. The caller sends the alert when shouldAlert is set. */
export async function score(
  req: AnalyzeRequest,
  elder: ElderSettings,
): Promise<{ state: RiskState; shouldAlert: boolean; bedrockMs: number }> {
  const started = Date.now();
  const window = recentWindow(req.utterances);
  const v = window.length
    ? parseVerdict(await askClaude(MODEL_ID, SYSTEM_PROMPT, buildUserMessage(elder.elderName, window), 200))
    : EMPTY;
  const bedrockMs = Date.now() - started;
  const d = decide(v, req);
  const state: RiskState = {
    callId: req.callId,
    risk: d.risk,
    level: d.level,
    tactics: d.tactics,
    reason: v.reason,
    action: d.action,
    updatedAt: Date.now(),
    calmStreak: d.calmStreak,
    claimedRelative: v.claimedRelative,
    elderState: v.elderState,
    verificationQuestion: d.action === 'ask_verification' ? elder.verificationQuestion : undefined,
    familyAlerted: false,
    // What the elder handed over: earlier results, the model (last ~60 s) and the rules (whole call).
    exposures: mergeExposures(req.exposures, v.exposures, detectExposures(req.utterances)),
  };
  return { state, shouldAlert: d.shouldAlert, bedrockMs };
}

export async function alertFamily(elder: ElderSettings, req: AnalyzeRequest, s: RiskState): Promise<void> {
  // Only the last few lines go in the alert (privacy section of the design doc).
  const lastLines = recentWindow(req.utterances)
    .slice(-3)
    .map((u) => `"${u.text.slice(0, 120)}"`)
    .join(' ');
  const message =
    `Call Me Maybe... NOT: ${elder.elderName} is on a likely scam call and is starting to go along with it. ` +
    `Signs: ${s.tactics.join(', ').replaceAll('_', ' ')}. ${s.reason} ` +
    (s.exposures?.length ? `They may already have given the caller ${exposureSentence(s.exposures, 'their')}. ` : '') +
    `Last words: ${lastLines} Please call them now.`;
  await sns.send(
    new PublishCommand({
      TopicArn: FAMILY_TOPIC_ARN,
      Subject: `Scam alert: ${elder.elderName} may be on a scam call`,
      Message: message.slice(0, 1400),
    }),
  );
}
