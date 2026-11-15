"""Train and evaluate the phrase-extraction + switching-HMM scam detector.

Experiments (all thresholds picked on validation calls for <=5% false alarms):
  standard      train on the BothBosu train splits, test on their test splits
  unseen-type   leave one scam type out of training, test on it (x4)
  cross-source  train on single-agent, test on multi-agent, and the reverse
  external      the standard model on 20 real YouTube scam calls and our test scripts
Baselines on the same splits:
  keyword-k     alarm once k distinct caller tactics have been seen (k tuned)
  rule          the production red rule without the LLM: 2+ tactics, one of them not scene-setting
  logreg        logistic regression on whole-call symbol counts (offline, sees the full call)

Usage: python run.py --data DATA_DIR --out OUT_DIR [--scripts test_scripts.json] [--jobs N]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from extract import Call, category_of, dump_structured, load_abcd, load_bothbosu, load_spokenwoz, load_test_scripts, symbols
from hmm_model import N_SYM, SwitchingHMM, compose, fit_best
from lexicon import ASK_CATEGORIES, CALLER

TARGET_FPR = 0.05
SCENE = {"IMPERSONATE", "URGENCY", "RELATIVE"}


# ------------------------------------------------------------------ scoring
def hmm_trace(model: SwitchingHMM, call: Call, unit: str) -> tuple[np.ndarray, list[int]]:
    obs, where = symbols(call, unit)
    return model.filter(obs), where


def caller_tactics(t) -> set[str]:
    """Caller tactic categories in a turn, ignoring negated asks."""
    return {category_of(p) for p in t.phrases} - {"NEGATED"} if t.role == "C" else set()


def keyword_trace(call: Call) -> tuple[np.ndarray, list[int]]:
    """Distinct caller tactic categories seen so far, per turn."""
    seen, out = set(), []
    for t in call.turns:
        seen |= caller_tactics(t)
        out.append(len(seen))
    return np.array(out, float), list(range(len(call.turns)))


def rule_trace(call: Call) -> tuple[np.ndarray, list[int]]:
    seen, out = set(), []
    for t in call.turns:
        seen |= caller_tactics(t)
        out.append(float(len(seen) >= 2 and bool(seen - SCENE)))
    return np.array(out), list(range(len(call.turns)))


def first_ask_turn(call: Call) -> int | None:
    for i, t in enumerate(call.turns):
        if caller_tactics(t) & ASK_CATEGORIES:
            return i
    return None


def pick_threshold(neg_scores: list[float]) -> float:
    return float(np.quantile(neg_scores, 1 - TARGET_FPR, method="higher")) if neg_scores else 0.5


def evaluate(calls: list[Call], trace_fn, threshold: float) -> dict:
    labels, maxes, det_turn, det_frac, before_ask = [], [], [], [], []
    for c in calls:
        tr, where = trace_fn(c)
        labels.append(c.label)
        maxes.append(float(tr.max()))
        hit = np.nonzero(tr > threshold)[0]
        if c.label == 1 and len(hit):
            turn = where[hit[0]]
            det_turn.append(turn)
            det_frac.append((turn + 1) / len(c.turns))
            ask = first_ask_turn(c)
            if ask is not None:
                before_ask.append(turn <= ask)
    labels, maxes = np.array(labels), np.array(maxes)
    pos, neg = labels == 1, labels == 0
    alarms = maxes > threshold
    res = {
        "n": int(len(labels)), "n_scam": int(pos.sum()), "n_normal": int(neg.sum()),
        "recall": float(alarms[pos].mean()) if pos.any() else None,
        "false_alarm_rate": float(alarms[neg].mean()) if neg.any() else None,
        "auc": float(roc_auc_score(labels, maxes)) if pos.any() and neg.any() else None,
        "median_detection_turn": float(np.median(det_turn)) if det_turn else None,
        "median_detection_fraction_of_call": float(np.median(det_frac)) if det_frac else None,
        "alarm_at_or_before_first_ask": float(np.mean(before_ask)) if before_ask else None,
    }
    return res


# ------------------------------------------------------------------ one experiment
def run_experiment(name: str, train: list[Call], tests: dict[str, list[Call]], args) -> tuple[dict, SwitchingHMM]:
    t0 = time.time()
    tr, val = train_test_split(train, test_size=0.2, random_state=0, stratify=[c.label for c in train])
    seq = lambda cs, y: [symbols(c, args.unit)[0] for c in cs if c.label == y]
    normal, info_n = fit_best(seq(tr, 0), seq(val, 0), args.ks, args.seeds, args.jobs)
    scam, info_s = fit_best(seq(tr, 1), seq(val, 1), args.ks, args.seeds, args.jobs)

    # Switching parameters: best recall on validation at <=5% false alarms (AUC breaks ties).
    best = None
    # back > 0 always: a non-forgetting filter saturates on long calls (see compose()).
    for switch in (0.005, 0.02, 0.05):
        for back in (0.01, 0.05, 0.1):
            for p0 in (0.05, 0.2, 0.5):
                m = compose(normal, scam, switch, p0, back)
                fn = lambda c, m=m: hmm_trace(m, c, args.unit)
                thr = pick_threshold([float(fn(c)[0].max()) for c in val if c.label == 0])
                r = evaluate(val, fn, thr)
                key = (r["recall"], r["auc"])
                if best is None or key > best[0]:
                    best = (key, m, thr, {"switch": switch, "back": back, "p_scam_start": p0})
    _, model, thr, sw = best
    hmm_fn = lambda c: hmm_trace(model, c, args.unit)

    # Baselines, thresholds tuned the same way.
    kw_thr = pick_threshold([float(keyword_trace(c)[0].max()) for c in val if c.label == 0])
    counts = lambda cs: np.array([np.bincount(symbols(c, "phrase")[0], minlength=N_SYM) / max(1, len(c.turns)) for c in cs])
    lr = LogisticRegression(max_iter=2000).fit(counts(tr), [c.label for c in tr])
    lr_thr = pick_threshold(list(lr.predict_proba(counts([c for c in val if c.label == 0]))[:, 1]))
    lr_fn = lambda c: (np.array([lr.predict_proba(counts([c]))[0, 1]]), [len(c.turns) - 1])

    out = {"train_calls": len(tr), "val_calls": len(val), "normal_hmm": info_n, "scam_hmm": info_s, "switching": sw,
           "threshold": thr, "keyword_k_threshold": kw_thr, "tests": {}}
    for tname, calls in tests.items():
        out["tests"][tname] = {
            "hmm": evaluate(calls, hmm_fn, thr),
            "keyword-k": evaluate(calls, keyword_trace, kw_thr),
            "rule": evaluate(calls, rule_trace, 0.5),
            "logreg (full call, offline)": evaluate(calls, lr_fn, lr_thr),
        }
    out["seconds"] = round(time.time() - t0, 1)
    print(f"[{name}] states normal={info_n['k']} scam={info_s['k']} switch={sw} thr={thr:.3f} ({out['seconds']}s)", flush=True)
    return out, model


# ------------------------------------------------------------------ report
def fmt(x, pct=True):
    return "—" if x is None else (f"{100 * x:.1f}%" if pct else f"{x:.3f}" if isinstance(x, float) and x < 1.0001 else f"{x:g}")


def report(results: dict) -> str:
    lines = ["# HMM scam detector results", "", f"Thresholds set on validation for ≤{int(TARGET_FPR * 100)}% false alarms.", ""]
    for exp, r in results.items():
        if exp.startswith("_"):
            continue
        lines += [f"## {exp}", "", f"States: normal {r['normal_hmm']['k']}, scam {r['scam_hmm']['k']}; switching {r['switching']}", ""]
        lines += ["| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |", "|---|---|---|---|---|---|---|"]
        for tname, methods in r["tests"].items():
            for meth, m in methods.items():
                lines.append(
                    f"| {tname} ({m['n_scam']} scam / {m['n_normal']} normal) | {meth} | {fmt(m['recall'])} | {fmt(m['false_alarm_rate'])} | "
                    f"{fmt(m['auc'], False)} | {fmt(m['median_detection_turn'], False)} | {fmt(m['alarm_at_or_before_first_ask'])} |"
                )
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--scripts", type=Path, default=Path(__file__).parent / "data" / "test_scripts.json")
    ap.add_argument("--unit", choices=["phrase", "turn"], default="phrase")
    ap.add_argument("--jobs", type=int, default=-1)
    ap.add_argument("--ks", type=int, nargs="+", default=[2, 4, 6, 8, 10, 12, 16])
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2, 3, 4])
    ap.add_argument("--hardneg-train", type=int, default=1000, help="normal calls sampled per hard-negative source for training")
    ap.add_argument("--hardneg-test", type=int, default=500, help="normal calls sampled per hard-negative source for testing")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    d = load_bothbosu(args.data)
    d |= load_abcd(args.data, {"train": args.hardneg_train, "test": args.hardneg_test})
    d |= load_spokenwoz(args.data, {"train": args.hardneg_train, "test": args.hardneg_test})
    ours = load_test_scripts(args.scripts)
    train_bb = d["multi/train"] + d["single/train"]
    test_bb = d["multi/test"] + d["single/test"]
    hardneg_train = d["abcd/train"] + d["spokenwoz/train"]
    print({k: len(v) for k, v in d.items()}, "ours", len(ours), flush=True)
    dump_structured(test_bb + d["abcd/test"] + d["spokenwoz/test"] + d["youtube/all"] + ours, args.out / "structured_extraction.jsonl")

    # Extraction coverage: share of calls where the caller side hits each category, per source.
    cov = {}
    groups = {"bothbosu scam": [c for c in train_bb if c.label], "bothbosu normal": [c for c in train_bb if not c.label],
              "abcd": d["abcd/train"], "spokenwoz": d["spokenwoz/train"], "youtube scam": d["youtube/all"]}
    for cat in [*CALLER, "NEGATED"]:
        for g, cs in groups.items():
            hit = sum(any(category_of(p) == cat for t in cs_t.turns if t.role == "C" for p in t.phrases) for cs_t in cs)
            cov.setdefault(cat, {})[g] = round(hit / max(1, len(cs)), 3)
    results: dict = {"_coverage_calls_with_category": cov, "_unit": args.unit}

    scams_test = [c for c in test_bb if c.label] + d["youtube/all"]
    normals_test = [c for c in test_bb if not c.label] + d["abcd/test"] + d["spokenwoz/test"]
    tests = {
        "BothBosu test": test_bb,
        "ABCD customer service (normal)": d["abcd/test"],
        "SpokenWOZ real phone calls (normal)": d["spokenwoz/test"],
        "YouTube real scams": d["youtube/all"],
        "ALL scams vs ALL normals": scams_test + normals_test,
        **({"our test scripts": ours} if ours else {}),
    }
    results["BothBosu only"], _ = run_experiment("bothbosu-only", train_bb, tests, args)
    main_res, model = run_experiment("with hard negatives", train_bb + hardneg_train, tests, args)
    results["with hard negatives"] = main_res
    (args.out / "model.json").write_text(json.dumps({**model.to_json(), "threshold": main_res["threshold"], "unit": args.unit}))

    # Per-script detail for our own scripts (small, worth eyeballing).
    if ours:
        results["_our_scripts"] = {
            c.type: {"label": c.label, "max_p_scam": round(float(hmm_trace(model, c, args.unit)[0].max()), 3),
                     "trace": [round(float(x), 3) for x in hmm_trace(model, c, args.unit)[0]]}
            for c in ours
        }

    for held in sorted({c.type for c in train_bb if c.label == 1}):
        tr = [c for c in train_bb + hardneg_train if not (c.label == 1 and c.type == held)]
        te = [c for c in test_bb if c.type == held] + normals_test
        results[f"unseen-type: {held}"], _ = run_experiment(f"unseen {held}", tr, {f"held-out '{held}' vs all normals": te}, args)

    for a, b in (("single", "multi"), ("multi", "single")):
        results[f"cross-source: {a} → {b}"], _ = run_experiment(
            f"{a}->{b}", d[f"{a}/train"], {f"{b} test": d[f"{b}/test"]}, args)

    results["_seconds_total"] = round(time.time() - t0, 1)
    (args.out / "results.json").write_text(json.dumps(results, indent=2))
    (args.out / "report.md").write_text(report(results))
    print(report(results))
    print(f"done in {results['_seconds_total']}s -> {args.out}")


if __name__ == "__main__":
    main()
