"""Phrase lexicon for structured extraction.

Written from the tactic definitions in backend/lambda/analyze/prompt.ts, not
tuned on the evaluation data. Caller (C:) and receiver (R:) phrases are
matched separately: the receiver saying "social security number" while
refusing is not the caller asking for it.
"""
import re

# Caller tactics, in priority order (used to break ties on overlapping matches).
CALLER = {
    "INFO": [
        r"social security (number|#)", r"\bssn\b", r"\bpassword", r"\bpin\b", r"account number", r"routing number",
        r"(credit|debit|card) (card )?number", r"bank (details|information|account)", r"date of birth",
        r"maiden name", r"verif(y|ication) (your|the) (identity|account|information|details)",
        r"confirm (your|the) (social|ssn|account|card|identity|full name|date)", r"(security|verification|one[- ]time) code",
        r"read (me )?(the )?(numbers|code|digits)", r"\botp\b", r"login (details|credentials)",
    ],
    "GIFT": [r"gift ?cards?", r"\bitunes\b", r"google play", r"steam card", r"\b(target|walmart|best buy|apple) cards?\b"],
    "PAY": [
        r"\bwire\b", r"bitcoin", r"\bcrypto", r"western union", r"moneygram", r"\bzelle\b", r"\bvenmo\b", r"cash ?app",
        r"processing fee", r"(small|one[- ]time|release|handling|clearance|activation) fee", r"\bbail\b",
        r"(send|transfer|deposit|pay) (us |me |the )?(the )?(money|funds|cash|payment|amount|\$)",
        r"\$\s?\d[\d,]*", r"\b\d[\d,]* dollars\b", r"make (a|the) payment",
    ],
    "REMOTE": [
        r"anydesk", r"teamviewer", r"remote (access|desktop|session|control)", r"(download|install) (this|the|an?|our)\b",
        r"access (to )?your (computer|device|screen)", r"(open|go to) (your )?(browser|the website|www)",
        r"type (in|this)", r"on your (computer )?screen", r"press (the )?windows key",
    ],
    "THREAT": [
        r"\barrest", r"\bwarrant\b", r"\bjail\b", r"lawsuit", r"legal action", r"\bsuspend(ed)?\b", r"\bfrozen\b",
        r"\bfreeze\b", r"(be|been|get) locked", r"\bdeport", r"criminal", r"under investigation", r"compromised",
        r"\bhacked\b", r"\bvirus\b", r"malware", r"penalt(y|ies)",
    ],
    "SECRECY": [
        r"(don'?t|do not) tell", r"keep (this|it) (between|secret|confidential|quiet|to yourself)", r"\bconfidential\b",
        r"(don'?t|do not) hang up", r"stay on the line", r"(don'?t|do not) (discuss|talk to|mention)",
    ],
    "URGENCY": [
        r"right (now|away)", r"\bimmediately\b", r"\burgent", r"as soon as possible", r"\basap\b", r"\bhurry\b",
        r"within (the next )?\d+ (minutes|hours)", r"(time is running out|act now|limited time)", r"\bexpir(e|es|ing)\b",
        r"before (it'?s too late|the end of (the )?day)", r"\btoday\b",
    ],
    "PRIZE": [
        r"\bwon\b", r"\bwinner\b", r"\bprize", r"sweepstakes", r"lottery", r"\brefund", r"overcharged",
        r"claim (your|the)", r"congratulations", r"\breward\b",
    ],
    "IMPERSONATE": [
        r"social security administration", r"\bssa\b", r"\birs\b", r"internal revenue", r"\bmedicare\b",
        r"\bofficer\b", r"\bsheriff", r"\bfbi\b", r"\bdetective\b", r"federal", r"government",
        r"microsoft", r"apple support", r"amazon", r"windows", r"tech(nical)? support", r"fraud department",
        r"(calling|this is .{0,30}) from (your|the) bank",
    ],
    "RELATIVE": [r"\bgrand(ma|pa|mother|father|son|daughter)\b", r"it'?s me\b", r"your (son|daughter|nephew|niece|grandkid)"],
}

RECEIVER = {
    "COMPLY": [
        r"\bmy (social security|ssn|card|account|password|pin|code)[^.?!]{0,20} is\b", r"\bhere (it is|you go)\b",
        r"\b\d{3}[- ]?\d{2}[- ]?\d{4}\b", r"\b(\d[ -]?){8,}\b",
        r"(okay|ok|alright|sure)[,.]? (i'?ll|i will|let me)", r"i'?ll (go|do it|get|buy|send|pay)",
        r"(i bought|i got the cards|i'?m at the store)", r"what do i (need to )?do", r"how much (do i|should i|is it)",
    ],
    "RESIST": [
        r"call (you |them )?back", r"hang(ing)? up", r"not comfortable", r"\bscam", r"i (don'?t|do not|won'?t|will not) (give|share|provide|send|pay)",
        r"no,? thank", r"who (is this|are you)", r"how did you get my", r"(i'?ll|i will) (call|contact) (my|the) (bank|son|daughter|police)",
        r"\breport (this|you)\b", r"(verify|prove) (this|that|who)",
    ],
}

CALLER_RE = {k: re.compile("|".join(f"(?:{p})" for p in v), re.I) for k, v in CALLER.items()}
RECEIVER_RE = {k: re.compile("|".join(f"(?:{p})" for p in v), re.I) for k, v in RECEIVER.items()}

# Caller categories that are an actual ask or pressure, not just scene-setting.
ASK_CATEGORIES = {"INFO", "GIFT", "PAY", "REMOTE"}

# Negation: an ask preceded in the same clause by one of these is not an ask
# ("we will never ask for your PIN", "you don't need to pay anything").
# Applied to ASK_CATEGORIES only: "you don't want to be arrested" is still a threat.
NEGATION = re.compile(
    r"\b(never|not|no one|nobody|won'?t|will not|don'?t|do not|doesn'?t|does not|didn'?t|did not|can'?t|cannot|"
    r"shouldn'?t|should not|no need|without)\b",
    re.I,
)
NEGATION_WINDOW_CHARS = 60  # look back this far, but never past a sentence boundary

# C:NEGATED = a caller turn that explicitly disclaims an ask: a normal-call signal.
SYMBOLS = ["C:NONE", *[f"C:{k}" for k in CALLER], "C:NEGATED", "R:NONE", *[f"R:{k}" for k in RECEIVER]]
SYM_ID = {s: i for i, s in enumerate(SYMBOLS)}
