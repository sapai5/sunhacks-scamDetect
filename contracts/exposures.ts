// "What next" after a scam call: what the elder handed over, and the steps to take now.
// Shared by the Lambdas (scoring, alerts) and the app (end-of-call screens). Pure, no I/O.
//
// Detection here is the rules side. The model also reports exposures (analyze/prompt.ts); score.ts
// merges both. These rules need exact speaker labels ('caller' / 'elder'), which the phone path and
// the test scripts have; on the speakerphone path (spk_0 / spk_1) the model is the only source.
//
// The steps are hand-written on purpose: advice to someone who was just scammed has to be right,
// so it never comes from the model.
import { EXPOSURES, type Exposure, type Utterance } from './index.js';

/** Whose thing it was: the elder reads "your card number", the family reads "their card number". */
export type Whose = 'your' | 'their';

/** Each one reads after "You may have given the caller ...". */
export function exposureLabel(e: Exposure, whose: Whose = 'your'): string {
  const labels: Record<Exposure, string> = {
    card_number: `${whose} card number`,
    bank_account: `${whose} bank account number`,
    ssn: `${whose} Social Security number`,
    medicare_number: `${whose} Medicare number`,
    one_time_code: 'a text code',
    password: 'a PIN or password',
    remote_access: `access to ${whose} computer`,
    gift_cards: 'gift cards',
    money_sent: 'money',
  };
  return labels[e];
}

/** Exposures that mean reading out a number: need a few digits before they count (3 is a false start). */
const NUMBER_KINDS: [Exposure, RegExp][] = [
  ['medicare_number', /\bmedicare (number|id|card number)\b/i],
  ['ssn', /\b(social security( number)?|ssn|my social)\b/i],
  ['card_number', /\b(card number|number on the (front|card)|code on the back|three digit code|expiration( date)?|cvv)\b/i],
  ['bank_account', /\b(account number|routing number|bank account)\b/i],
  ['one_time_code', /\b((text|texted|six digit|verification|security|one[- ]time) code|code (we|i) (just )?(sent|texted))\b/i],
];
const PASSWORD_ASK = /\b(password|passcode|pin)\b/i;
const GIFT_ASK = /\b(gift ?cards?|(google play|itunes|apple|steam|target|amazon|ebay) cards?|read me the codes|scratch)\b/i;
const REMOTE_ASK = /\b(remote access|teamviewer|anydesk|ultraviewer|logmein|install|download|your computer)\b/i;
/** Callers who say what they will never ask for ("we never need your card number") aren't asking. */
const NEGATED = /\b(never|won'?t|will not|don'?t need|do not need|please stop)\b[^.?!]*/gi;

const PASSWORD_GIVEN = /\b(password|passcode|pin)( number)? is\b/i;
const GIFT_BOUGHT = /\b(i (bought|got|have|picked up)|i'?ve got)\b[^.?!]*\bcards?\b/i;
const REMOTE_DONE = /\b(typing in|installing|downloading|i (installed|downloaded|clicked|opened|typed)|it'?s (open|installed|downloading|done)|you can see my screen)\b/i;
/** Money already gone, not a promise to send ("I'll send it" is complying, not an exposure yet). */
const MONEY_SENT = /\b(i (just )?(sent|wired|transferred|zelled|venmoed) (it|the|you|him|her|them|\$?\d+)|the money('?s| is| has been| was) sent|it'?s sent)\b/i;
// "oh" is left out: "Oh my goodness" is far more common on these calls than "oh" for zero.
const DIGIT = /\b(zero|one|two|three|four|five|six|seven|eight|nine|\d+)\b/gi;

/** Spoken digits in a line ("four one two eight" -> 4; numerals count each digit). */
export function digitCount(text: string): number {
  return (text.match(DIGIT) ?? []).reduce((n, d) => n + (/^\d+$/.test(d) ? d.length : 1), 0);
}

/**
 * What the elder handed over, from the whole transcript. A number counts when the elder reads 4+
 * digits right after the caller asked for that kind of number (or names it themselves).
 */
export function detectExposures(utterances: Pick<Utterance, 'speaker' | 'text'>[]): Exposure[] {
  const found = new Set<Exposure>();
  const recentAsks: string[] = []; // the caller's last two lines, negations removed
  let callerSoFar = '';
  for (const u of utterances) {
    if (u.speaker === 'agent') continue;
    if (u.speaker !== 'elder') {
      const asked = u.text.replace(NEGATED, '');
      recentAsks.push(asked);
      if (recentAsks.length > 2) recentAsks.shift();
      callerSoFar += ` ${asked}`;
      continue;
    }
    const context = `${recentAsks.join(' ')} ${u.text.replace(NEGATED, '')}`;
    const digits = digitCount(u.text);
    if (digits >= 4) {
      const kind = NUMBER_KINDS.find(([, re]) => re.test(context));
      if (kind) found.add(kind[0]);
      else if (PASSWORD_ASK.test(context)) found.add('password'); // a PIN read out
      else if (GIFT_ASK.test(context)) found.add('gift_cards'); // reading gift card codes
    }
    if (PASSWORD_GIVEN.test(u.text)) found.add('password');
    if (GIFT_BOUGHT.test(u.text) && GIFT_ASK.test(`${callerSoFar} ${u.text}`)) found.add('gift_cards');
    if (REMOTE_DONE.test(u.text) && REMOTE_ASK.test(`${callerSoFar} ${u.text}`)) found.add('remote_access');
    if (MONEY_SENT.test(u.text)) found.add('money_sent');
  }
  return mergeExposures([...found]);
}

/** Union of exposure lists, in the fixed EXPOSURES order. Unknown values are dropped. */
export function mergeExposures(...lists: (readonly string[] | undefined)[]): Exposure[] {
  const all = new Set(lists.flatMap((l) => l ?? []));
  return EXPOSURES.filter((e) => all.has(e));
}

/** "your card number", "your card number and a text code", "your card number, a PIN or password and money". */
export function exposureSentence(list: readonly Exposure[], whose: Whose = 'your'): string {
  const names = list.map((e) => exposureLabel(e, whose));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface RecoveryStep {
  id: string;
  title: string;
  detail: string;
  /** Big tap-to-call button. */
  call?: { label: string; tel: string };
  /** Website to open. */
  link?: { label: string; href: string };
}

// Phone numbers: the official credit-freeze lines and agencies. Re-check before each release.
const STEPS: Record<Exposure, RecoveryStep> = {
  remote_access: {
    id: 'remote_access',
    title: 'Turn off your computer now',
    detail: "They may still be able to control it. Unplug it or hold the power button. Don't use it for banking until someone you trust has checked it, and change your passwords from a different device.",
  },
  money_sent: {
    id: 'money_sent',
    title: 'Call your bank or the money service right away',
    detail: 'Ask them to stop or recall the payment and tell them it was a scam. The sooner you call, the better the chance of getting it back. Use the number on your card or statement.',
  },
  gift_cards: {
    id: 'gift_cards',
    title: 'Call the gift card company',
    detail: 'Use the phone number printed on the back of the card. Tell them it was a scam and ask them to freeze the money. Keep the cards and the receipt.',
  },
  card_number: {
    id: 'card_number',
    title: 'Cancel your card',
    detail: 'Call the number on the back of your card. Say your number was stolen in a scam call, ask for a new card, and ask about any charges you did not make.',
  },
  bank_account: {
    id: 'bank_account',
    title: 'Call your bank',
    detail: 'Use the number on your statement or the back of your card, not a number the caller gave you. Tell them your account number was given to a scammer and ask them to watch or close the account.',
  },
  one_time_code: {
    id: 'one_time_code',
    title: 'Secure the account the code was for',
    detail: 'That code lets someone into your account. Call the company using a number you look up yourself, tell them, and change your password.',
  },
  password: {
    id: 'password',
    title: 'Change that PIN or password',
    detail: 'Change it today, and anywhere else you use the same one. If it was a bank PIN, call your bank.',
  },
  ssn: {
    id: 'ssn',
    title: 'Freeze your credit: Equifax',
    detail: 'This stops anyone opening loans or cards in your name. It is free. Start with Equifax, then the other two bureaus below, then make a recovery plan at IdentityTheft.gov.',
    call: { label: 'Call Equifax', tel: '+18882980045' },
    link: { label: 'Open IdentityTheft.gov', href: 'https://www.identitytheft.gov/' },
  },
  medicare_number: {
    id: 'medicare_number',
    title: 'Call Medicare',
    detail: 'Tell them your Medicare number was given to a scammer. Check your next Medicare statements for services you never got.',
    call: { label: 'Call 1-800-MEDICARE', tel: '+18006334227' },
  },
};

const CREDIT_FREEZE_EXTRA: RecoveryStep[] = [
  { id: 'ssn_experian', title: 'Freeze your credit: Experian', detail: 'Second of the three credit bureaus.', call: { label: 'Call Experian', tel: '+18883973742' } },
  { id: 'ssn_transunion', title: 'Freeze your credit: TransUnion', detail: 'Last of the three credit bureaus.', call: { label: 'Call TransUnion', tel: '+18889098872' } },
];

/** Most urgent first: someone still in the computer, then money that can still be recalled, then numbers. */
const URGENCY: Exposure[] = ['remote_access', 'money_sent', 'gift_cards', 'card_number', 'bank_account', 'one_time_code', 'password', 'ssn', 'medicare_number'];

/**
 * The steps for what was handed over, most urgent first, then the steps for every scam call.
 * Nothing handed over: only those general steps on a likely scam (`scam`), otherwise none.
 */
export function whatNext(exposures: readonly Exposure[], opts: { familyPhone?: string; scam?: boolean } = {}): RecoveryStep[] {
  // A likely scam where nothing was handed over still gets the steps for every scam call.
  if (!exposures.length && !opts.scam) return [];
  const steps: RecoveryStep[] = [];
  for (const e of URGENCY) {
    if (!exposures.includes(e)) continue;
    steps.push(STEPS[e]);
    if (e === 'ssn') steps.push(...CREDIT_FREEZE_EXTRA);
  }
  steps.push(
    {
      id: 'family',
      title: 'Tell your family',
      detail: 'They can help you make these calls. You did nothing wrong. These callers are professionals.',
      ...(opts.familyPhone && { call: { label: 'Call my family', tel: opts.familyPhone.replace(/[^+\d]/g, '') } }),
    },
    {
      id: 'callbacks',
      title: "Don't trust a call back",
      detail: 'Scammers often call again, sometimes pretending to be police or a bank offering to get your money back. Hang up and call the number you look up yourself.',
    },
    {
      id: 'report',
      title: 'Report it',
      detail: 'Reporting helps stop these callers. The AARP Fraud Watch helpline can walk you through it for free.',
      call: { label: 'Call AARP fraud helpline', tel: '+18779083360' },
      link: { label: 'Open ReportFraud.ftc.gov', href: 'https://reportfraud.ftc.gov/' },
    },
  );
  return steps;
}
