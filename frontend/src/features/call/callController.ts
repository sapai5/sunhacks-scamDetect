// Call session logic with no React in it. Owns all Stage 1 call state (the
// browser sends it with every Analyze request), serializes Analyze calls so each
// one carries the previous level, and exposes immutable snapshots for the UI via
// subscribe/getSnapshot (useSyncExternalStore).
import type { AnalyzeRequest, Level, RiskState, Tactic, Utterance, Verification } from '@contracts';
import { errorMessage } from '../../services/http';
import type { AnalyzeClient, StopFn, TranscriptSource } from '../../services/types';

export type CallPhase = 'idle' | 'connecting' | 'active' | 'ended';
export type SourceKind = 'mic' | 'demo';

export interface CallSnapshot {
  phase: CallPhase;
  source: SourceKind | null;
  /** Demo script title, when source is 'demo'. */
  sourceLabel: string | null;
  callId: string;
  startedAt: number | null;
  endedAt: number | null;
  utterances: Utterance[];
  /** Sentence still being transcribed. */
  partial: string;
  /** Latest result from Analyze. */
  risk: RiskState;
  peakLevel: Level;
  peakRisk: number;
  tacticsSeen: Tactic[];
  verification: Verification;
  /** Question to show the elder; null when there's nothing to ask. */
  pendingQuestion: string | null;
  familyAlerted: boolean;
  analyzing: boolean;
  lastLatencyMs: number | null;
  status: string;
  error: string | null;
}

export interface CallControllerDeps {
  analyze: AnalyzeClient;
  elderId: string;
  now?: () => number;
  newCallId?: () => string;
}

const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

export const emptyRisk = (callId = ''): RiskState => ({
  callId,
  risk: 0,
  level: 'green',
  tactics: [],
  reason: '',
  action: 'none',
  updatedAt: 0,
  calmStreak: 0,
  claimedRelative: false,
  familyAlerted: false,
});

export const initialSnapshot = (): CallSnapshot => ({
  phase: 'idle',
  source: null,
  sourceLabel: null,
  callId: '',
  startedAt: null,
  endedAt: null,
  utterances: [],
  partial: '',
  risk: emptyRisk(),
  peakLevel: 'green',
  peakRisk: 0,
  tacticsSeen: [],
  verification: 'unasked',
  pendingQuestion: null,
  familyAlerted: false,
  analyzing: false,
  lastLatencyMs: null,
  status: '',
  error: null,
});

export class CallController {
  private snap = initialSnapshot();
  private listeners = new Set<() => void>();
  private stopSource: StopFn | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Call with an Analyze request queued but not yet started. */
  private queuedFor: string | null = null;
  private readonly now: () => number;
  private readonly newCallId: () => string;

  constructor(private readonly deps: CallControllerDeps) {
    this.now = deps.now ?? Date.now;
    this.newCallId = deps.newCallId ?? (() => `c-${crypto.randomUUID().slice(0, 8)}`);
  }

  getSnapshot = (): CallSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Resolves once every queued Analyze request has settled. */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  async start(source: TranscriptSource, kind: SourceKind, label?: string): Promise<boolean> {
    this.endSource();
    const callId = this.newCallId();
    this.queue = Promise.resolve();
    this.set({
      ...initialSnapshot(),
      phase: 'connecting',
      source: kind,
      sourceLabel: label ?? null,
      callId,
      startedAt: this.now(),
      risk: emptyRisk(callId),
      status: kind === 'mic' ? 'Connecting…' : 'Starting demo…',
    });

    const isCurrent = () => this.snap.callId === callId && this.snap.phase !== 'ended';
    try {
      const stop = await source.start({
        onPartial: (text) => isCurrent() && this.set({ partial: text }),
        onFinal: (text) => isCurrent() && this.addSentence(text),
        onError: (err) => isCurrent() && this.set({ error: errorMessage(err), status: `Transcription problem: ${errorMessage(err)}` }),
        onEnd: () => isCurrent() && this.set({ status: 'Demo finished. Tap End call to see the summary.' }),
      });
      if (!isCurrent()) {
        stop(); // ended while connecting
        return false;
      }
      this.stopSource = stop;
      this.set({
        phase: 'active',
        status: kind === 'mic' ? 'Listening. Put the call on speaker next to this device.' : `Playing demo: ${label ?? ''}`,
      });
      return true;
    } catch (err) {
      if (this.snap.callId === callId) {
        this.set({ phase: 'ended', endedAt: this.now(), error: errorMessage(err), status: `Could not start: ${errorMessage(err)}` });
      }
      return false;
    }
  }

  /** End the call. Results already in flight still land, so the summary is complete. */
  stop(): void {
    if (this.snap.phase !== 'connecting' && this.snap.phase !== 'active') return;
    this.endSource();
    this.set({ phase: 'ended', endedAt: this.now(), partial: '', status: 'Call ended. Nothing was saved.' });
  }

  /** Back to idle; drops the transcript from memory. */
  reset(): void {
    this.endSource();
    this.queue = Promise.resolve();
    this.set(initialSnapshot());
  }

  answerVerification(result: Exclude<Verification, 'unasked'>): void {
    this.set({ verification: result, pendingQuestion: null });
    // Re-score now with the answer instead of waiting for the next sentence.
    if (this.snap.utterances.length) this.enqueueAnalyze();
  }

  private endSource() {
    this.stopSource?.();
    this.stopSource = null;
  }

  private addSentence(text: string) {
    const { callId, utterances } = this.snap;
    const u: Utterance = { callId, elderId: this.deps.elderId, speaker: 'caller', text, ts: this.now(), seq: utterances.length };
    this.set({ utterances: [...utterances, u], partial: '' });
    this.enqueueAnalyze();
  }

  /**
   * One request in flight at a time. Sentences that arrive meanwhile share a
   * single follow-up request, which reads the newest transcript when it runs.
   */
  private enqueueAnalyze() {
    const callId = this.snap.callId;
    if (this.queuedFor === callId) return;
    this.queuedFor = callId;
    this.queue = this.queue.then(() => {
      if (this.queuedFor === callId) this.queuedFor = null;
      return this.runAnalyze(callId);
    });
  }

  private async runAnalyze(callId: string) {
    if (this.snap.callId !== callId) return;
    const s = this.snap;
    const req: AnalyzeRequest = {
      callId,
      elderId: this.deps.elderId,
      utterances: s.utterances,
      prevLevel: s.risk.level,
      calmStreak: s.risk.calmStreak,
      verification: s.verification,
    };
    this.set({ analyzing: true });
    const t0 = this.now();
    try {
      const result = await this.deps.analyze.analyze(req);
      if (this.snap.callId !== callId) return;
      this.applyRisk(result, this.now() - t0);
    } catch (err) {
      if (this.snap.callId !== callId) return;
      // Keep showing the last level while waiting.
      this.set({ analyzing: false, status: `Check failed (${errorMessage(err)}). Showing the last result.` });
    }
  }

  private applyRisk(r: RiskState, ms: number) {
    const s = this.snap;
    const ask = r.action === 'ask_verification' && s.verification === 'unasked' && r.verificationQuestion;
    this.set({
      risk: r,
      analyzing: false,
      lastLatencyMs: ms,
      peakLevel: RANK[r.level] > RANK[s.peakLevel] ? r.level : s.peakLevel,
      peakRisk: Math.max(s.peakRisk, r.risk),
      tacticsSeen: [...new Set([...s.tacticsSeen, ...r.tactics])],
      pendingQuestion: ask ? r.verificationQuestion! : s.pendingQuestion,
      familyAlerted: s.familyAlerted || r.familyAlerted,
      status: s.phase === 'active' ? `Checked in ${ms} ms` : s.status,
    });
  }

  private set(patch: Partial<CallSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }
}
