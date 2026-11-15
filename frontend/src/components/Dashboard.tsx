// Dashboard / family-summary components. Each maps 1:1 to a Figma component (see "Figma:").
// Data comes from the backend RiskState: tactics are mapped onto the four Figma stages,
// and the per-line number is the risk change that line caused (the design's "LLR").
import { useEffect, useRef } from 'react';
import type { Tactic, Utterance, Verification } from '../../../contracts/index.js';
import type { RiskPoint } from '../lib/snapshot';
import { RISK_RED, RISK_YELLOW, STAGE_LABEL, STAGES, TACTIC_STAGE, tacticLabel, type Stage } from '../lib/stages';
import { clock } from './Risk';
import './components.css';

/** Figma: Transcript/TacticChip (one per Figma stage). */
export function TacticChip({ stage }: { stage: Stage }) {
  return <span className="tactic-chip">{STAGE_LABEL[stage]}</span>;
}

const fmtDelta = (v: number) => `Δ ${v >= 0 ? '+' : '−'}${Math.abs(v)}`;

/** Figma: Transcript/Line. `delta` = risk change caused by this line. */
export function TranscriptLine({ u, startedAt, delta, tactics = [] }: { u: Utterance; startedAt: number; delta?: number; tactics?: Tactic[] }) {
  const stages = [...new Set(tactics.map((t) => TACTIC_STAGE[t]))];
  return (
    <div className={`transcript-line transcript-line--${u.speaker}`}>
      <p className="transcript-line__time">{clock(Math.max(0, (u.ts - startedAt) / 1000))}</p>
      <div className="transcript-line__body">
        <div className="transcript-line__meta">
          <p className="transcript-line__speaker">{u.speaker}</p>
          {stages.map((s) => (
            <TacticChip key={s} stage={s} />
          ))}
        </div>
        <p className="transcript-line__text">{u.text}</p>
      </div>
      {delta !== undefined && <p className={`transcript-line__llr${delta > 0 ? ' is-hot' : ''}`}>{fmtDelta(delta)}</p>}
    </div>
  );
}

/** Per-line risk change and newly seen tactics, from the analyze history. */
export function lineScores(history: RiskPoint[]) {
  const bySeq = new Map<number, { delta: number; tactics: Tactic[] }>();
  let prev = 0;
  for (const p of history) {
    const cur = bySeq.get(p.seq) ?? { delta: 0, tactics: [] };
    cur.delta += p.risk - prev;
    cur.tactics.push(...p.newTactics);
    bySeq.set(p.seq, cur);
    prev = p.risk;
  }
  return bySeq;
}

/** Transcript list; scrolls to the newest line. */
export function Transcript({ utterances, history, startedAt, limit }: { utterances: Utterance[]; history: RiskPoint[]; startedAt: number; limit?: number }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Skip inside the schematic's iframes: scrollIntoView would scroll the parent page too.
    if (utterances.length && window.self === window.top) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [utterances.length]);
  const scores = lineScores(history);
  const shown = limit ? utterances.slice(-limit) : utterances;
  return (
    <div className="transcript">
      {utterances.length === 0 && <p className="transcript__empty">Waiting for the first words…</p>}
      {shown.map((u) => (
        <TranscriptLine key={u.seq} u={u} startedAt={startedAt} delta={scores.get(u.seq)?.delta} tactics={scores.get(u.seq)?.tactics} />
      ))}
      <div ref={end} />
    </div>
  );
}

/** Figma: Stage/Tracker */
export function StageTracker({ hit }: { hit: Set<Stage> }) {
  return (
    <div className="stage-tracker">
      <p className="eyebrow">Scam stages</p>
      <div className="stage-tracker__steps">
        {STAGES.map((s) => (
          <div key={s} className={`stage-step${hit.has(s) ? ' is-hit' : ''}`}>
            <span className="stage-step__dot" />
            <p className="stage-step__label">{STAGE_LABEL[s]}</p>
          </div>
        ))}
      </div>
      <p className="stage-tracker__note">Red needs 2+ tactics and risk ≥ {RISK_RED}, or a wrong family answer</p>
    </div>
  );
}

/** Figma: VerifyCard. pending = blue, failed = red (the Figma state), passed = green. */
export function VerifyCard({ question, verification, delta }: { question: string; verification: Verification; delta?: number }) {
  const result = verification === 'unasked' ? 'pending' : verification === 'failed' ? 'wrong' : 'correct';
  return (
    <div className="verify-card" data-result={result}>
      <p className="eyebrow verify-card__eyebrow">Family question</p>
      <p className="verify-card__question">“{question}”</p>
      {result === 'pending' ? (
        <p className="verify-card__answer">Waiting for the caller’s answer…</p>
      ) : (
        <p className="verify-card__result">
          {result === 'wrong' ? 'Wrong or dodged' : 'Correct'}
          {delta !== undefined ? `  ${fmtDelta(delta)}` : ''}
        </p>
      )}
    </div>
  );
}

/** Figma: adjudication card on D3 ("Engine unsure · asking Bedrock"). Shows the model's reason and tactics. */
export function VerdictCard({ reason, tactics, level }: { reason: string; tactics: Tactic[]; level: string }) {
  const verdict = level === 'red' ? 'scam' : level === 'yellow' ? 'likely scam' : 'looks normal';
  return (
    <div className="verdict-card">
      <p className="eyebrow verdict-card__eyebrow">Bedrock · Claude Haiku</p>
      <p className="verdict-card__body">{reason || 'No reason yet.'}</p>
      <p className="verdict-card__verdict">
        Bedrock verdict: {verdict}
        {tactics.length > 0 && ` (${tactics.map(tacticLabel).join(' + ')})`}
      </p>
    </div>
  );
}

/** Figma: Evidence/Chart. Plots risk (0–100) after each analyze, with the backend's yellow/red thresholds. */
export function EvidenceChart({ history }: { history: RiskPoint[] }) {
  const W = 760, H = 300, X0 = 55, PW = 680, TOP = 52, BOTTOM = 250;
  const y = (r: number) => BOTTOM - ((BOTTOM - TOP) * r) / 100;
  const series = [0, ...history.map((p) => p.risk)];
  const slots = Math.max(series.length - 1, 8);
  const x = (i: number) => X0 + (PW * i) / slots;
  const pts = series.map((r, i) => [x(i), y(r)] as const);
  const noteIdx = history.findLastIndex((p) => p.note) + 1;
  const note = noteIdx > 0 ? history[noteIdx - 1] : undefined;
  const yRed = y(RISK_RED), yYellow = y(RISK_YELLOW);
  return (
    <div className="evidence-chart">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Risk over the call">
        <text x="15" y="29" className="chart-title">Risk over the call</text>
        <rect x={X0} y={yRed} width={PW} height={yYellow - yRed} fill="var(--color-caution-tint)" />
        <line x1={X0} x2={X0 + PW} y1={yRed} y2={yRed} stroke="var(--color-danger)" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={X0 + PW} y={yRed - 6} textAnchor="end" className="chart-mono" fill="var(--color-danger)">red at risk ≥ {RISK_RED}</text>
        <line x1={X0} x2={X0 + PW} y1={yYellow} y2={yYellow} stroke="var(--color-safe)" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={X0 + PW} y={yYellow + 16} textAnchor="end" className="chart-mono" fill="var(--color-safe)">green below {RISK_YELLOW}</text>
        <line x1={X0} x2={X0 + PW} y1={y(0)} y2={y(0)} stroke="var(--color-border)" strokeWidth="1" />
        <text x="35" y={y(0) + 4} className="chart-mono" fill="var(--color-text-muted)">0</text>
        <text x="28" y={y(100) + 4} className="chart-mono" fill="var(--color-text-muted)">100</text>
        <text x={X0 + PW} y="283" textAnchor="end" className="chart-small" fill="var(--color-text-muted)">utterances →</text>
        {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--color-text)" strokeWidth="2" strokeLinejoin="round" />}
        {pts.map(([px, py], i) => {
          const isNote = i === noteIdx && note;
          return <circle key={i} cx={px} cy={py} r={isNote ? 6 : 4} fill={isNote ? 'var(--color-danger)' : 'var(--color-text)'} className={i === pts.length - 1 ? 'chart-point--new' : undefined} />;
        })}
        {note && (
          <text
            x={pts[noteIdx][0] + (pts[noteIdx][0] < X0 + 280 ? 12 : -12)}
            y={pts[noteIdx][1] + 4}
            textAnchor={pts[noteIdx][0] < X0 + 280 ? 'start' : 'end'}
            className="chart-note"
            fill="var(--color-danger)"
          >
            {note.note}: {fmtDelta(note.risk - series[noteIdx - 1])}
          </text>
        )}
      </svg>
    </div>
  );
}

/** Figma: metric tile on D4. */
export function MetricTile({ value = '—', label, sub }: { value?: string; label: string; sub: string }) {
  return (
    <div className="metric-tile">
      <p className="metric-tile__value">{value}</p>
      <p className="metric-tile__label">{label}</p>
      <p className="metric-tile__sub">{sub}</p>
    </div>
  );
}

/** Figma: "top bar" on D1–D5. */
export function DashboardTopBar({ title, meta, children }: { title: string; meta: string; children?: React.ReactNode }) {
  return (
    <header className="dash-top">
      <h1 className="dash-top__title">{title}</h1>
      <div className="dash-top__right">
        <p className="dash-top__meta">{meta}</p>
        {children}
      </div>
    </header>
  );
}
