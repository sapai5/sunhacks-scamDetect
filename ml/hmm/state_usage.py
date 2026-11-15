"""Which hidden states does each kind of call spend its time in?

Runs the shipped switching HMM (model.json) over labeled calls and averages the
posterior state occupancy per group: each BothBosu scam type (refund, reward,
ssn, support), BothBosu normal calls, and optionally YouTube scams and our own
test scripts. If the scam types light up different scam states, the model
separated them without ever seeing the type labels (it was trained on
scam / normal only).

Occupancy uses forward-backward (smoothed) posteriors: offline, we can use the
whole call to say where each symbol most likely sat. The forward-only
(filtered) version, which is what production computes, is reported too.

Each call counts equally (its own mean over time), so long calls don't dominate.

Usage:
  python state_usage.py --data DATA_DIR --model results/1553096/model.json --out results/state-usage
  python state_usage.py --model results/1553096/model.json --out /tmp/su   # our test scripts only
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from extract import Call, load_bothbosu, load_test_scripts, symbols
from lexicon import SYMBOLS


# ------------------------------------------------------------------ model
def load_model(path: Path) -> dict:
    m = json.loads(path.read_text())
    if m["symbols"] != SYMBOLS:
        raise SystemExit(f"{path} was trained with a different lexicon than lexicon.py")
    return {
        "start": np.asarray(m["start"]),
        "trans": np.asarray(m["trans"]),
        "emis": np.asarray(m["emis"]),
        "n_normal": int(m["nNormal"]),
        "unit": m.get("unit", "phrase"),
    }


def posteriors(m: dict, obs: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """Scaled forward-backward. Returns (filtered, smoothed), each T x K, rows sum to 1."""
    A, B = m["trans"], m["emis"]
    T, K = len(obs), len(m["start"])
    alpha = np.empty((T, K))
    scale = np.empty(T)
    a = m["start"] * B[:, obs[0]]
    scale[0] = a.sum()
    alpha[0] = a / scale[0]
    for t in range(1, T):
        a = (alpha[t - 1] @ A) * B[:, obs[t]]
        scale[t] = a.sum()
        alpha[t] = a / scale[t]
    beta = np.ones((T, K))
    for t in range(T - 2, -1, -1):
        beta[t] = A @ (B[:, obs[t + 1]] * beta[t + 1]) / scale[t + 1]
    gamma = alpha * beta
    gamma /= gamma.sum(1, keepdims=True)
    return alpha, gamma


# ------------------------------------------------------------------ grouping
def gather(args) -> dict[str, list[Call]]:
    groups: dict[str, list[Call]] = defaultdict(list)
    if args.data:
        d = load_bothbosu(args.data)
        splits = {"train": ["multi/train", "single/train"], "test": ["multi/test", "single/test"]}
        keys = splits.get(args.split, splits["train"] + splits["test"])
        for k in keys:
            for c in d[k]:
                groups[f"scam: {c.type}" if c.label else "normal (BothBosu)"].append(c)
        if args.youtube:
            for c in d["youtube/all"]:
                groups["YouTube scams" if c.label else "YouTube normal"].append(c)
    for c in load_test_scripts(args.scripts):
        groups["our scripts: scam" if c.label else "our scripts: normal"].append(c)
    return dict(groups)


# ------------------------------------------------------------------ analysis
def state_names(m: dict) -> list[str]:
    """Label each state by its top two emissions, e.g. 's28 C:PAY 0.92 / C:IMPERSONATE 0.06'."""
    out = []
    for s, row in enumerate(m["emis"]):
        top = np.argsort(-row)[:2]
        out.append(f"s{s} " + " / ".join(f"{SYMBOLS[j]} {row[j]:.2f}" for j in top))
    return out


def analyse(m: dict, groups: dict[str, list[Call]]) -> dict:
    K, kn = len(m["start"]), m["n_normal"]
    res: dict = {"n_states": K, "n_normal": kn, "groups": {}}
    pos_sum, pos_w = np.zeros(K), np.zeros(K)  # where in the call each state is used (scam calls only)
    for name, calls in groups.items():
        occ_s, occ_f, n = np.zeros(K), np.zeros(K), 0
        for c in calls:
            obs, _ = symbols(c, m["unit"])
            if not obs:
                continue
            filt, smooth = posteriors(m, obs)
            occ_s += smooth.mean(0)
            occ_f += filt.mean(0)
            n += 1
            if c.label == 1:
                rel = np.linspace(0, 1, len(obs)) if len(obs) > 1 else np.zeros(1)
                pos_sum += (smooth * rel[:, None]).sum(0)
                pos_w += smooth.sum(0)
        if not n:
            continue
        occ_s, occ_f = occ_s / n, occ_f / n
        scam_s = occ_s[kn:] / occ_s[kn:].sum()
        res["groups"][name] = {
            "calls": n,
            "occupancy_smoothed": occ_s.round(4).tolist(),
            "occupancy_filtered": occ_f.round(4).tolist(),
            "time_in_scam_half_smoothed": round(float(occ_s[kn:].sum()), 4),
            "time_in_scam_half_filtered": round(float(occ_f[kn:].sum()), 4),
            "scam_state_share": scam_s.round(4).tolist(),  # within the scam half, sums to 1
        }
    res["state_mean_position"] = np.where(pos_w > 0, pos_sum / np.maximum(pos_w, 1e-12), np.nan).round(3).tolist()

    # Lift: how much more a scam type uses a scam state than the scam types on average.
    types = [g for g in res["groups"] if g.startswith("scam: ")]
    if types:
        share = np.array([res["groups"][g]["scam_state_share"] for g in types])
        lift = share / np.maximum(share.mean(0, keepdims=True), 1e-12)
        res["scam_type_lift"] = {g: lift[i].round(2).tolist() for i, g in enumerate(types)}
        # One number for "did the types separate?": mean total-variation distance between type profiles (0..1).
        tv = [0.5 * np.abs(share[i] - share[j]).sum() for i in range(len(types)) for j in range(i + 1, len(types))]
        res["scam_type_mean_tv_distance"] = round(float(np.mean(tv)), 3) if tv else None
    return res


# ------------------------------------------------------------------ report
def report(m: dict, res: dict) -> str:
    kn, K = res["n_normal"], res["n_states"]
    names = state_names(m)
    pos = res["state_mean_position"]
    g = res["groups"]
    lines = ["# Hidden-state usage by call type", ""]
    lines += ["Smoothed (forward-backward) posteriors from the shipped model, averaged per call, then over calls.", ""]

    lines += ["## Time spent in the scam half", "", "| group | calls | smoothed | filtered (production) |", "|---|---|---|---|"]
    for name, r in g.items():
        lines.append(f"| {name} | {r['calls']} | {r['time_in_scam_half_smoothed']:.1%} | {r['time_in_scam_half_filtered']:.1%} |")

    lines += ["", "## Share of scam-half time per scam state", "",
              "Each column sums to 100%. Bold = at least 1.5× that state's average share across scam types.", ""]
    cols = [n for n in g if g[n]["time_in_scam_half_smoothed"] > 0]
    lines.append("| state | top emissions | mean position in scam calls | " + " | ".join(cols) + " |")
    lines.append("|---|---|---|" + "---|" * len(cols))
    lift = res.get("scam_type_lift", {})
    for s in range(kn, K):
        cells = []
        for n in cols:
            v = g[n]["scam_state_share"][s - kn]
            bold = n in lift and lift[n][s - kn] >= 1.5 and v >= 0.03
            cells.append(f"**{v:.1%}**" if bold else f"{v:.1%}")
        p = pos[s]
        lines.append(f"| s{s} | {names[s].split(' ', 1)[1]} | {'—' if p != p else f'{p:.2f}'} | " + " | ".join(cells) + " |")

    if lift:
        lines += ["", "## Most distinctive scam states per type", "", "| scam type | states (lift vs. other types, share) |", "|---|---|"]
        for n, l in lift.items():
            share = g[n]["scam_state_share"]
            top = sorted(range(K - kn), key=lambda i: -(l[i] if share[i] >= 0.03 else 0))[:3]
            lines.append(f"| {n[6:]} | " + ", ".join(f"{names[kn + i]} (×{l[i]:.1f}, {share[i]:.0%})" for i in top) + " |")
        lines += ["", f"Mean total-variation distance between scam-type profiles: **{res['scam_type_mean_tv_distance']}** "
                  "(0 = identical state usage, 1 = no overlap)."]

    lines += ["", "## Scam states in call order", "", "Mean relative position (0 = first symbol, 1 = last) where each scam state holds the belief, scam calls only.", ""]
    order = sorted((p, s) for s, p in enumerate(pos) if s >= kn and p == p)
    lines += [f"- {p:.2f} · {names[s]}" for p, s in order]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, help="DATA_DIR with the BothBosu folders (as for run.py); omit to use only --scripts")
    ap.add_argument("--model", type=Path, default=Path(__file__).parent / "results" / "1553096" / "model.json")
    ap.add_argument("--scripts", type=Path, default=Path(__file__).parent / "data" / "test_scripts.json")
    ap.add_argument("--split", choices=["train", "test", "all"], default="all")
    ap.add_argument("--youtube", action="store_true", help="add the 20 YouTube scams as their own group")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    m = load_model(args.model)
    groups = gather(args)
    print({k: len(v) for k, v in groups.items()}, flush=True)
    res = analyse(m, groups)
    res["state_names"] = state_names(m)
    (args.out / "state_usage.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    md = report(m, res)
    (args.out / "state_usage.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"-> {args.out}")


if __name__ == "__main__":
    main()
