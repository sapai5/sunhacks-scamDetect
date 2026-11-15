"""Two class-conditional HMMs joined into one switching HMM, filtered online.

States 0..Kn-1 come from the normal-call HMM, Kn..Kn+Ks-1 from the scam HMM.
A call can switch from any normal state into the scam block (probability
`switch` per step, entering by the scam HMM's start distribution) and back
(probability `back`), so the score tracks recent evidence. The forward filter gives P(in a scam state | observations so
far) after every observation: that is the live score, and the alarm is a
threshold on it.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from hmmlearn.hmm import CategoricalHMM
from joblib import Parallel, delayed

from lexicon import SYMBOLS

N_SYM = len(SYMBOLS)


def _stack(seqs: list[list[int]]):
    return np.concatenate([np.asarray(s) for s in seqs]).reshape(-1, 1), [len(s) for s in seqs]


def _smooth(m: CategoricalHMM, alpha: float = 1e-3) -> CategoricalHMM:
    """Keep unseen symbols and transitions possible (avoids -inf on new data)."""
    m.emissionprob_ = (m.emissionprob_ + alpha) / (m.emissionprob_ + alpha).sum(1, keepdims=True)
    m.transmat_ = (m.transmat_ + 1e-6) / (m.transmat_ + 1e-6).sum(1, keepdims=True)
    m.startprob_ = (m.startprob_ + 1e-6) / (m.startprob_ + 1e-6).sum()
    return m


def _fit_one(train: list[list[int]], k: int, seed: int) -> CategoricalHMM:
    X, lengths = _stack(train)
    m = CategoricalHMM(n_components=k, n_features=N_SYM, n_iter=300, tol=1e-4, random_state=seed, init_params="ste", params="ste")
    m.fit(X, lengths)
    return _smooth(m)


def fit_best(train: list[list[int]], val: list[list[int]], ks, seeds, n_jobs: int) -> tuple[CategoricalHMM, dict]:
    """Grid over state counts and random restarts; pick by held-out log-likelihood per symbol."""
    grid = [(k, s) for k in ks for s in seeds]
    models = Parallel(n_jobs=n_jobs)(delayed(_fit_one)(train, k, s) for k, s in grid)
    Xv, lv = _stack(val)
    scores = [m.score(Xv, lv) / len(Xv) for m in models]
    best = int(np.argmax(scores))
    by_k = {k: max(sc for (kk, _), sc in zip(grid, scores) if kk == k) for k in ks}
    return models[best], {"k": grid[best][0], "seed": grid[best][1], "val_ll_per_symbol": scores[best], "val_ll_by_k": by_k}


@dataclass
class SwitchingHMM:
    start: np.ndarray
    trans: np.ndarray
    emis: np.ndarray
    n_normal: int

    def filter(self, obs: list[int]) -> np.ndarray:
        """P(scam block) after each observation (normalized forward recursion)."""
        out = np.empty(len(obs))
        alpha = self.start * self.emis[:, obs[0]]
        alpha /= alpha.sum()
        out[0] = alpha[self.n_normal:].sum()
        for t in range(1, len(obs)):
            alpha = (alpha @ self.trans) * self.emis[:, obs[t]]
            alpha /= alpha.sum()
            out[t] = alpha[self.n_normal:].sum()
        return out

    def to_json(self) -> dict:
        return {
            "symbols": SYMBOLS,
            "nNormal": self.n_normal,
            "start": self.start.tolist(),
            "trans": self.trans.tolist(),
            "emis": self.emis.tolist(),
        }


def compose(normal: CategoricalHMM, scam: CategoricalHMM, switch: float, p_scam_start: float, back: float = 0.0) -> SwitchingHMM:
    """`back` > 0 lets the filter leave the scam block again, so old evidence fades.
    Without it the posterior is a whole-call likelihood ratio that saturates on long
    calls, and a threshold tuned on short calls fires on every long normal call."""
    kn, ks = normal.n_components, scam.n_components
    start = np.concatenate([(1 - p_scam_start) * normal.startprob_, p_scam_start * scam.startprob_])
    trans = np.zeros((kn + ks, kn + ks))
    trans[:kn, :kn] = (1 - switch) * normal.transmat_
    trans[:kn, kn:] = switch * scam.startprob_[None, :]
    trans[kn:, kn:] = (1 - back) * scam.transmat_
    trans[kn:, :kn] = back * normal.startprob_[None, :]
    emis = np.vstack([normal.emissionprob_, scam.emissionprob_])
    return SwitchingHMM(start, trans, emis, kn)
