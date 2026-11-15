// After a screened call ends, one text to each close contact the elder saved.
// Pure: the Twilio bridge sends it. A call that stayed safe is quiet, so family isn't texted
// about a pharmacy reminder. No raw transcript: a line can contain a card number.
import type { AgentStatus, ElderState, Exposure, Level, Tactic } from '../../../contracts/index.js';
import { exposureSentence } from '../../../contracts/exposures.js';
import { normalize } from '../../telephony/contacts-check/index.js';

export interface FamilyRecapInput {
  elderName: string;
  level?: Level;
  /** The mid-call family alert already fired, so the call reached red even if the last score cooled off. */
  familyAlerted?: boolean;
  reason?: string;
  tactics?: Tactic[];
  elderState?: ElderState;
  claimedRelative?: boolean;
  exposures?: Exposure[];
  agentStatus?: AgentStatus;
  agentName?: string;
  agentSummary?: string;
  webUrl: string;
  callId: string;
}

const TACTIC: Record<Tactic, string> = {
  impersonation: 'pretended to be a relative or an official',
  urgency: 'pressured them to act right now',
  secrecy: 'told them not to tell anyone',
  payment_request: 'asked for money',
  gift_cards: 'asked for gift cards',
  wire_or_crypto: 'asked for a wire, an app payment, or crypto',
  remote_access: 'asked to control their computer',
  personal_info_request: 'asked for personal numbers or codes',
  threats: 'threatened them',
};

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function agentNote(name: string, helper: string, status: AgentStatus | undefined, summary: string | undefined): string | undefined {
  if (!status || status === 'idle') return undefined;
  const who = helper.trim() || 'A helper';
  const lead =
    status === 'scam_confirmed'
      ? `${who} joined the call, decided it was a scam, and ended it.`
      : status === 'verified'
        ? `${who} joined the call. The caller answered the family question, so the phone was handed back.`
        : status === 'stopped'
          ? `${who} joined the call. ${name} asked them to step back and kept talking.`
          : `${who} joined the call. The call ended while they were still on the line.`;
  const note = summary?.trim().slice(0, 500);
  return note ? `${lead} ${note}` : lead;
}

/**
 * The text, or null when there is nothing the family needs to hear (a safe call, no helper, nothing handed over).
 * Kept under 1400 characters, with the link intact.
 */
export function familyRecap(input: FamilyRecapInput): string | null {
  const name = input.elderName.trim() || 'Your family member';
  const level: Level | undefined = input.familyAlerted ? 'red' : input.level;
  const helperJoined = Boolean(input.agentStatus && input.agentStatus !== 'idle');
  const handedOver = (input.exposures?.length ?? 0) > 0;
  if (level !== 'red' && level !== 'yellow' && !helperJoined && !handedOver) return null;

  const headline =
    level === 'red'
      ? `${name} just hung up on a call that looked like a scam.`
      : level === 'yellow'
        ? `${name} just hung up on a call that had warning signs.`
        : `${name}'s call just ended.`;

  const parts = [`ScamDetermine: ${headline}`];
  const reason = input.reason?.trim().slice(0, 280);
  if (reason) parts.push(reason);

  const tactics = (input.tactics ?? []).map((t) => TACTIC[t]).filter(Boolean);
  if (input.claimedRelative && !input.tactics?.includes('impersonation')) tactics.unshift('claimed to be a relative');
  if (tactics.length) parts.push(`The caller ${andList(tactics)}.`);

  if (input.elderState === 'complying') parts.push(`${name} was going along with what the caller asked.`);
  else if (input.elderState === 'engaging') parts.push(`${name} was starting to go along with it.`);

  if (handedOver) parts.push(`${name} may have given the caller ${exposureSentence(input.exposures!, 'their')}.`);

  const agent = agentNote(name, input.agentName ?? '', input.agentStatus, input.agentSummary);
  if (agent) parts.push(agent);

  parts.push(`Please check in with ${name}. Don't trust a call back from that number.`);
  const link = `${input.webUrl.replace(/\/+$/, '')}/elder/call?id=${encodeURIComponent(input.callId)}`;
  // The link has to survive the length cap. Shorten the notes above it, never the link.
  let body = parts.join('\n\n');
  const room = 1400 - link.length - 2;
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  return `${body}\n\n${link}`;
}

/** Close contacts to text, as E.164. Skips blanks, the elder's own phone, and duplicates. */
export function familyPhones(family: { phone?: unknown }[] | undefined, elderPhone?: string): string[] {
  const elder = elderPhone ? normalize(elderPhone) : '';
  const out: string[] = [];
  for (const c of family ?? []) {
    if (typeof c?.phone !== 'string' || !c.phone.trim()) continue;
    const n = normalize(c.phone);
    const digits = n.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) continue;
    if (n === elder || out.includes(n)) continue;
    out.push(n);
  }
  return out;
}
