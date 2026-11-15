// Scoring shared by the Analyze Lambda (browser calls) and IngestFn (phone calls):
// last ~60 s -> Bedrock -> level rules, plus the family alert.
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { AnalyzeRequest, ElderSettings, RiskState } from '../../../contracts/index.js';
import { detectExposures, exposureSentence, mergeExposures } from '../../../contracts/exposures.js';
import { askClaude } from '../shared/bedrock.js';
import { scoreHmm, type HmmResult } from './hmm/hmm.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { decide, parseVerdict, recentWindow, type ModelVerdict } from './rules.js';

const sns = new SNSClient({});
const MODEL_ID = process.env.MODEL_ID!;
const FAMILY_TOPIC_ARN = process.env.FAMILY_TOPIC_ARN!;
/** Share of the risk score from the phrase HMM; the rest is Claude's. 0 turns the HMM off. */
const HMM_WEIGHT = Math.min(1, Math.max(0, Number(process.env.HMM_WEIGHT ?? '0.35')));

const EMPTY: ModelVerdict = { risk: 0, tactics: [], reason: '', claimedRelative: false, elderState: 'none' };

/** Ensemble: risk = (1 - w) * Claude risk + w * 100 * HMM P(scam). Everything else stays Claude's. */
export function blend(v: ModelVerdict, hmm: HmmResult, w = HMM_WEIGHT): ModelVerdict {
  if (w <= 0) return v;
  return { ...v, risk: Math.round((1 - w) * v.risk + w * 100 * hmm.pScam) };
}

/**
 * Claude is unavailable: score with the phrase HMM alone. Tactics come from the
 * phrase lexicon. The elder is at most "engaging" (a compliant phrase was heard),
 * never "complying", so regex matches alone can alert the family but never hand
 * the call to the agent.
 */
export function hmmOnlyVerdict(hmm: HmmResult): ModelVerdict {
  return {
    risk: Math.round(100 * hmm.pScam),
    tactics: hmm.tactics,
    reason: hmm.tactics.length
      ? `Heard ${hmm.tactics.map((t) => t.replaceAll('_', ' ')).join(', ')} (phrase model; Claude unavailable).`
      : 'Phrase model only (Claude unavailable).',
    claimedRelative: hmm.claimedRelative,
    elderState: hmm.receiverComplied ? 'engaging' : 'none',
  };
}

/**
 * Score the call so far: Claude on the last ~60 s blended with the phrase HMM on the
 * whole call. If Claude fails, the HMM scores alone (unless HMM_WEIGHT=0, then this
 * throws as before). The caller sends the alert when shouldAlert is set.
 */
export async function score(
  req: AnalyzeRequest,
  elder: ElderSettings,
): Promise<{ state: RiskState; shouldAlert: boolean; bedrockMs: number }> {
  const started = Date.now();
  const window = recentWindow(req.utterances);
  const hmm = scoreHmm(req.utterances);
  let v: ModelVerdict;
  try {
    v = window.length
      ? parseVerdict(await askClaude(MODEL_ID, SYSTEM_PROMPT, buildUserMessage(elder.elderName, window), 200))
      : EMPTY;
    v = blend(v, hmm);
  } catch (err) {
    if (HMM_WEIGHT <= 0) throw err;
    console.error('claude failed, scoring with the phrase HMM only', err);
    v = hmmOnlyVerdict(hmm);
  }
  const bedrockMs = Date.now() - started;
  console.log(JSON.stringify({ callId: req.callId, hmmPScam: Number(hmm.pScam.toFixed(3)), blendedRisk: v.risk, hmmWeight: HMM_WEIGHT }));
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
    `Scam Shield: ${elder.elderName} is on a likely scam call and is starting to go along with it. ` +
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
