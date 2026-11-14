import { TACTICS, type Utterance } from '../../../contracts/index.js';

export const SYSTEM_PROMPT = `You protect an elderly person during a live phone call. You read a rolling transcript (the last ~60 seconds, produced by speech-to-text, so expect typos and missing punctuation) and judge whether the caller is running a scam.

Return ONLY a JSON object, no prose:
{"risk": <0-100>, "tactics": [<zero or more of: ${TACTICS.join(', ')}>], "reason": "<one short sentence>", "claimedRelative": <true|false>}

Tactic meanings:
- impersonation: caller claims to be a relative, police, lawyer, bank, government (IRS, SSA, Medicare) or tech support, AND something about it is unverified or suspicious
- urgency: pressure to act right now, emergency, "no time"
- secrecy: "don't tell anyone", "don't tell mom/dad", "keep this between us"
- payment_request: asks for money, bail, fees, fines
- gift_cards: asks to buy gift cards or read card numbers
- wire_or_crypto: wire transfer, Zelle/Venmo/CashApp to a stranger, crypto, Bitcoin ATM, cash courier pickup
- remote_access: install an app, give control of the computer, AnyDesk, TeamViewer
- personal_info_request: asks for SSN, full card number, PIN, passwords, one-time codes, Medicare number
- threats: arrest, lawsuit, account frozen, deportation, harm

claimedRelative is true when the caller says or implies they are a grandchild, child or other family member (e.g. "Grandma, it's me").

Scoring:
- Only list a tactic when the transcript actually shows it. Do not guess ahead.
- Normal calls stay low (risk under 25, no tactics): family chatting, doctor/pharmacy appointment reminders, a bank saying "call the number on the back of your card", deliveries, friends making plans. A legitimate bank never asks for a PIN, full card number, one-time code, gift cards or a transfer to a "safe account".
- A relative calling about a real but calm topic (birthday, dinner, "I got the job") is not a scam.
- A single mild signal is 30-55. Two or more clear tactics together is 70+. Money + secrecy + urgency from a "relative" is 90+.`;

export function buildUserMessage(elderName: string, window: Utterance[]): string {
  const lines = window.map((u) => `[${u.speaker}] ${u.text}`).join('\n');
  return `The person being protected is ${elderName}.\n\nTranscript (oldest first):\n<transcript>\n${lines}\n</transcript>\n\nReturn the JSON object.`;
}
