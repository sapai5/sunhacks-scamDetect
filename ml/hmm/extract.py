"""Load calls and turn each turn into structured phrase matches and HMM symbols."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from lexicon import ASK_CATEGORIES, CALLER_RE, NEGATION, NEGATION_WINDOW_CHARS, RECEIVER_RE, SYM_ID

TAG = re.compile(r"\b(Suspect|Innocent)\s*:")


@dataclass
class Turn:
    role: str  # "C" caller, "R" receiver
    text: str
    phrases: list[dict] = field(default_factory=list)  # {category, text, start, end}


@dataclass
class Call:
    id: str
    source: str
    label: int  # 1 scam, 0 normal
    type: str
    turns: list[Turn]


def normalize(s: str) -> str:
    s = re.sub(r"\s+", " ", str(s).replace("’", "'").replace("‘", "'"))
    return re.sub(r"\s+([,.?!;:])", r"\1", s).strip()  # ASR style "okay , i'll" -> "okay, i'll"


def parse_dialogue(text: str) -> list[Turn]:
    parts = TAG.split(str(text))
    turns = []
    for i in range(1, len(parts) - 1, 2):
        body = normalize(parts[i + 1])
        if body:
            turns.append(Turn("C" if parts[i] == "Suspect" else "R", body))
    return turns


def extract(turn: Turn) -> Turn:
    """Find non-overlapping phrase matches; earlier categories in the lexicon win ties."""
    table = CALLER_RE if turn.role == "C" else RECEIVER_RE
    found = []
    for rank, (cat, rx) in enumerate(table.items()):
        for m in rx.finditer(turn.text):
            found.append((m.start(), rank, m.end(), cat, m.group(0)))
    found.sort()
    kept, last_end = [], -1
    for start, _, end, cat, txt in found:
        if start >= last_end:
            p = {"category": cat, "text": txt, "start": start, "end": end}
            if turn.role == "C" and cat in ASK_CATEGORIES and negated(turn.text, start):
                p["negated"] = True
            kept.append(p)
            last_end = end
    turn.phrases = kept
    return turn


def negated(text: str, start: int) -> bool:
    """A negation cue earlier in the same sentence, within NEGATION_WINDOW_CHARS."""
    before = text[max(0, start - NEGATION_WINDOW_CHARS):start]
    before = re.split(r"[.?!;]", before)[-1]
    return bool(NEGATION.search(before))


def category_of(p: dict) -> str:
    return "NEGATED" if p.get("negated") else p["category"]


def symbols(call: Call, unit: str = "phrase") -> tuple[list[int], list[int]]:
    """Observation sequence and, for each observation, the turn it came from.

    unit="phrase": one symbol per matched phrase (consecutive repeats in a turn
    collapsed), or <role>:NONE for a turn with no match.
    unit="turn": one symbol per turn, the highest-priority category matched.
    """
    obs, where = [], []
    for ti, t in enumerate(call.turns):
        cats = [category_of(p) for p in t.phrases]
        if unit == "turn":
            table = [*CALLER_RE, "NEGATED"] if t.role == "C" else list(RECEIVER_RE)
            cats = [c for c in table if c in cats][:1]
        seq = []
        for c in cats:
            if not seq or seq[-1] != c:
                seq.append(c)
        for c in seq or ["NONE"]:
            obs.append(SYM_ID[f"{t.role}:{c}"])
            where.append(ti)
    return obs, where


def load_bothbosu(data_dir: Path) -> dict[str, list[Call]]:
    """{'<source>/<split>': [Call]} for the two synthetic sets, plus youtube/all."""
    files = {
        "multi": ("multi-agent-scam-conversation", "agent_conversation_{}.csv"),
        "single": ("single-agent-scam-conversations", "single-agent-scam-dialogue_{}.csv"),
    }
    out: dict[str, list[Call]] = {}
    for src, (folder, pattern) in files.items():
        for split in ("train", "test"):
            df = pd.read_csv(data_dir / folder / pattern.format(split))
            out[f"{src}/{split}"] = [
                Call(f"{src}-{split}-{i}", src, int(r.labels), str(r.type), [extract(t) for t in parse_dialogue(r.dialogue)])
                for i, r in enumerate(df.itertuples())
            ]
    yt = pd.read_csv(data_dir / "youtube-scam-conversations" / "youtube_scam_conversations.csv")
    out["youtube/all"] = [
        Call(f"youtube-{i}", "youtube", int(r.labels), str(r.type), [extract(t) for t in parse_dialogue(r.dialogue)])
        for i, r in enumerate(yt.itertuples())
    ]
    return out


def _sample(items: list, n: int | None, seed: int = 0) -> list:
    if n is None or len(items) <= n:
        return items
    import random
    return random.Random(seed).sample(items, n)


def load_abcd(data_dir: Path, per_split: dict[str, int | None]) -> dict[str, list[Call]]:
    """ABCD (asappresearch/abcd, MIT): customer-service chats where the agent asks for
    names, account IDs, order numbers and handles refunds and payments. All normal (label 0).
    The agent is the party asking, so it takes the caller role."""
    import gzip
    raw = json.load(gzip.open(data_dir / "abcd" / "abcd_v1.1.json.gz"))
    out = {}
    for split, n in per_split.items():
        calls = []
        for c in _sample(raw[split], n):
            turns = [extract(Turn("C" if who == "agent" else "R", normalize(txt)))
                     for who, txt in c["original"] if who in ("agent", "customer") and normalize(txt)]
            if turns:
                calls.append(Call(f"abcd-{c['convo_id']}", "abcd", 0, f"abcd-{c['scenario']['flow']}", turns))
        out[f"abcd/{split}"] = calls
    return out


def load_spokenwoz(data_dir: Path, per_split: dict[str, int | None]) -> dict[str, list[Call]]:
    """SpokenWOZ (CC BY-NC 4.0): transcripts of real human-to-human phone calls
    (bookings, police, hospital, taxi). All normal. The agent (system side) takes the caller role."""
    root = data_dir / "spokenwoz"
    train = json.load(open(root / "SpokenWOZ-Train-Text" / "data.json"))
    test = json.load(open(root / "SpokenWOZ-Test-Text-Fixed" / "data.json"))
    sources = {"train": train, "test": test}
    out = {}
    for split, n in per_split.items():
        calls = []
        for did in _sample(sorted(sources[split]), n):
            turns = []
            for i, e in enumerate(sources[split][did].get("log", [])):
                who = str(e.get("tag") or e.get("speaker") or e.get("role") or ("user" if i % 2 == 0 else "system")).lower()
                text = normalize(e.get("text", ""))
                if text:
                    turns.append(extract(Turn("R" if who.startswith("user") else "C", text)))
            if turns:
                calls.append(Call(f"swoz-{did}", "spokenwoz", 0, "spokenwoz", turns))
        out[f"spokenwoz/{split}"] = calls
    return out


def load_test_scripts(path: Path) -> list[Call]:
    """Our backend/scripts/test-scripts.ts, exported to JSON by export-test-scripts.ts."""
    if not path.exists():
        return []
    calls = []
    for s in json.loads(path.read_text()):
        turns = [extract(Turn("C" if l["speaker"] == "caller" else "R", normalize(l["text"]))) for l in s["lines"]]
        calls.append(Call(f"ours-{s['name']}", "ours", int(s["expectedPeak"] == "red"), s["name"], turns))
    return calls


def dump_structured(calls: list[Call], path: Path) -> None:
    """The structured extraction itself, one JSON object per call (JSONL)."""
    with path.open("w") as f:
        for c in calls:
            f.write(json.dumps({
                "id": c.id, "source": c.source, "label": c.label, "type": c.type,
                "turns": [{"role": t.role, "text": t.text, "phrases": t.phrases} for t in c.turns],
            }) + "\n")
