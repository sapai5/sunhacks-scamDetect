// Phrase lexicon for the HMM. A TypeScript copy of ml/hmm/lexicon.py: keep the two
// in sync (same categories, same order, same patterns), or the trained model's
// symbols no longer mean the same thing. hmm.ts checks the symbol list against model.json.

export const CALLER: Record<string, string[]> = {
  INFO: [
    'social security (number|#)', '\\bssn\\b', '\\bpassword', '\\bpin\\b', 'account number', 'routing number',
    '(credit|debit|card) (card )?number', 'bank (details|information|account)', 'date of birth',
    'maiden name', 'verif(y|ication) (your|the) (identity|account|information|details)',
    'confirm (your|the) (social|ssn|account|card|identity|full name|date)', '(security|verification|one[- ]time) code',
    'read (me )?(the )?(numbers|code|digits)', '\\botp\\b', 'login (details|credentials)',
  ],
  GIFT: ['gift ?cards?', '\\bitunes\\b', 'google play', 'steam card', '\\b(target|walmart|best buy|apple) cards?\\b'],
  PAY: [
    '\\bwire\\b', 'bitcoin', '\\bcrypto', 'western union', 'moneygram', '\\bzelle\\b', '\\bvenmo\\b', 'cash ?app',
    'processing fee', '(small|one[- ]time|release|handling|clearance|activation) fee', '\\bbail\\b',
    '(send|transfer|deposit|pay) (us |me |the )?(the )?(money|funds|cash|payment|amount|\\$)',
    '\\$\\s?\\d[\\d,]*', '\\b\\d[\\d,]* dollars\\b', 'make (a|the) payment',
  ],
  REMOTE: [
    'anydesk', 'teamviewer', 'remote (access|desktop|session|control)', '(download|install) (this|the|an?|our)\\b',
    'access (to )?your (computer|device|screen)', '(open|go to) (your )?(browser|the website|www)',
    'type (in|this)', 'on your (computer )?screen', 'press (the )?windows key',
  ],
  THREAT: [
    '\\barrest', '\\bwarrant\\b', '\\bjail\\b', 'lawsuit', 'legal action', '\\bsuspend(ed)?\\b', '\\bfrozen\\b',
    '\\bfreeze\\b', '(be|been|get) locked', '\\bdeport', 'criminal', 'under investigation', 'compromised',
    '\\bhacked\\b', '\\bvirus\\b', 'malware', 'penalt(y|ies)',
  ],
  SECRECY: [
    "(don'?t|do not) tell", 'keep (this|it) (between|secret|confidential|quiet|to yourself)', '\\bconfidential\\b',
    "(don'?t|do not) hang up", 'stay on the line', "(don'?t|do not) (discuss|talk to|mention)",
  ],
  URGENCY: [
    'right (now|away)', '\\bimmediately\\b', '\\burgent', 'as soon as possible', '\\basap\\b', '\\bhurry\\b',
    'within (the next )?\\d+ (minutes|hours)', '(time is running out|act now|limited time)', '\\bexpir(e|es|ing)\\b',
    "before (it'?s too late|the end of (the )?day)", '\\btoday\\b',
  ],
  PRIZE: [
    '\\bwon\\b', '\\bwinner\\b', '\\bprize', 'sweepstakes', 'lottery', '\\brefund', 'overcharged',
    'claim (your|the)', 'congratulations', '\\breward\\b',
  ],
  IMPERSONATE: [
    'social security administration', '\\bssa\\b', '\\birs\\b', 'internal revenue', '\\bmedicare\\b',
    '\\bofficer\\b', '\\bsheriff', '\\bfbi\\b', '\\bdetective\\b', 'federal', 'government',
    'microsoft', 'apple support', 'amazon', 'windows', 'tech(nical)? support', 'fraud department',
    '(calling|this is .{0,30}) from (your|the) bank',
  ],
  RELATIVE: ['\\bgrand(ma|pa|mother|father|son|daughter)\\b', "it'?s me\\b", 'your (son|daughter|nephew|niece|grandkid)'],
};

export const RECEIVER: Record<string, string[]> = {
  COMPLY: [
    '\\bmy (social security|ssn|card|account|password|pin|code)[^.?!]{0,20} is\\b', '\\bhere (it is|you go)\\b',
    '\\b\\d{3}[- ]?\\d{2}[- ]?\\d{4}\\b', '\\b(\\d[ -]?){8,}\\b',
    "(okay|ok|alright|sure)[,.]? (i'?ll|i will|let me)", "i'?ll (go|do it|get|buy|send|pay)",
    "(i bought|i got the cards|i'?m at the store)", 'what do i (need to )?do', 'how much (do i|should i|is it)',
  ],
  RESIST: [
    'call (you |them )?back', 'hang(ing)? up', 'not comfortable', '\\bscam', "i (don'?t|do not|won'?t|will not) (give|share|provide|send|pay)",
    'no,? thank', 'who (is this|are you)', 'how did you get my', "(i'?ll|i will) (call|contact) (my|the) (bank|son|daughter|police)",
    '\\breport (this|you)\\b', '(verify|prove) (this|that|who)',
  ],
};

const compile = (patterns: string[]) => new RegExp(patterns.map((p) => `(?:${p})`).join('|'), 'gi');
export const CALLER_RE: [string, RegExp][] = Object.entries(CALLER).map(([k, v]) => [k, compile(v)]);
export const RECEIVER_RE: [string, RegExp][] = Object.entries(RECEIVER).map(([k, v]) => [k, compile(v)]);

/** Caller categories that are an actual ask, not scene-setting. Only these can be negated. */
export const ASK_CATEGORIES = new Set(['INFO', 'GIFT', 'PAY', 'REMOTE']);

export const NEGATION =
  /\b(never|not|no one|nobody|won'?t|will not|don'?t|do not|doesn'?t|does not|didn'?t|did not|can'?t|cannot|shouldn'?t|should not|no need|without)\b/i;
export const NEGATION_WINDOW_CHARS = 60;

export const SYMBOLS = [
  'C:NONE',
  ...Object.keys(CALLER).map((k) => `C:${k}`),
  'C:NEGATED',
  'R:NONE',
  ...Object.keys(RECEIVER).map((k) => `R:${k}`),
];
