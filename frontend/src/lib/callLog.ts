// Call log: every call this phone showed (speakerphone, demo or pushed phone call), with its
// transcript, kept in this browser only. Saved as the call goes, so a crash or a closed tab still
// leaves the call in the log. Capped to the latest MAX_CALLS calls and MAX_AGE_DAYS days.
//
// Phone-path calls (pushed over the socket) only carry risk results, not sentences, so their
// entries have no transcript until the backend sends one.
import { useEffect } from 'react';
import type { AgentStatus, Exposure, Level, PushMessage, RiskState, Tactic, Utterance } from '../../../contracts/index.js';
import { detectExposures, mergeExposures } from '../../../contracts/exposures.js';
import { EMPTY_SNAPSHOT, type CallSnapshot, type LoggedEvent, type RiskPoint } from './snapshot';

export interface CallLogEntry {
  callId: string;
  startedAt: number;
  /** Last time the call changed (the end time once it's over). */
  updatedAt: number;
  running: boolean;
  /** Highest level the call reached. */
  peak: Level;
  risk: RiskState | null;
  tactics: Tactic[];
  /** What the elder handed over during the call (never shrinks). Old entries may not have it. */
  exposures?: Exposure[];
  familyAlerted: boolean;
  agentStatus: AgentStatus;
  transcript: Utterance[];
  history: RiskPoint[];
  events: LoggedEvent[];
}

const KEY = 'scamdetermine.callLog';
const MAX_CALLS = 30;
const MAX_AGE_DAYS = 30;
const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

export function loadCallLog(): CallLogEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CallLogEntry[];
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    return Array.isArray(list) ? list.filter((c) => c.updatedAt >= cutoff).sort((a, b) => b.startedAt - a.startedAt) : [];
  } catch {
    return [];
  }
}

function save(list: CallLogEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CALLS)));
  } catch {
    /* storage full or blocked: the log is best effort */
  }
}

export function getCall(callId: string): CallLogEntry | undefined {
  return loadCallLog().find((c) => c.callId === callId);
}

export function deleteCall(callId: string) {
  save(loadCallLog().filter((c) => c.callId !== callId));
}

export function clearCallLog() {
  save([]);
}

/** Pure: the log entry for a snapshot, or null when there's nothing worth keeping yet. */
export function entryFor(s: CallSnapshot, prev?: CallLogEntry): CallLogEntry | null {
  if (!s.callId || (!s.transcript.length && !s.risk)) return null;
  const levels = [...s.history.map((p) => p.level), s.risk?.level ?? 'green', prev?.peak ?? 'green'];
  const peak = levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), 'green');
  const tactics = [...new Set([...(prev?.tactics ?? []), ...s.history.flatMap((p) => p.newTactics), ...(s.risk?.tactics ?? [])])];
  return {
    callId: s.callId,
    startedAt: s.startedAt ?? prev?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
    running: s.running,
    peak,
    risk: s.risk,
    tactics,
    // The backend's list, plus the same rules run here so demo mode and the offline backup scorer get it too.
    exposures: mergeExposures(prev?.exposures, s.risk?.exposures, detectExposures(s.transcript)),
    familyAlerted: Boolean(s.risk?.familyAlerted || prev?.familyAlerted),
    agentStatus: s.agentStatus,
    // Keep what we already had if this snapshot carries less (e.g. a phone call after a reload).
    transcript: s.transcript.length >= (prev?.transcript.length ?? 0) ? s.transcript : prev!.transcript,
    history: s.history.length >= (prev?.history.length ?? 0) ? s.history : prev!.history,
    events: s.events.length >= (prev?.events.length ?? 0) ? s.events : prev!.events,
  };
}

/**
 * A phone call the app learned about from the push socket, including one that already ended
 * while the page was suspended. Keeps a transcript the phone already saved. An ended call
 * stays ended: a later copy of the same message does not stretch its duration.
 */
export function mergePushedCall(prev: CallLogEntry | undefined, next: PushMessage): CallLogEntry | null {
  const risk: RiskState = {
    callId: next.callId,
    risk: next.risk,
    level: next.level,
    tactics: next.tactics,
    reason: next.reason,
    action: next.action,
    updatedAt: next.updatedAt,
    calmStreak: next.calmStreak,
    claimedRelative: next.claimedRelative,
    elderState: next.elderState,
    verificationQuestion: next.verificationQuestion,
    familyAlerted: Boolean(next.familyAlerted || prev?.familyAlerted),
    exposures: next.exposures,
  };
  const entry = entryFor(
    {
      ...EMPTY_SNAPSHOT,
      callId: next.callId,
      running: !next.ended,
      startedAt: prev?.startedAt ?? next.updatedAt,
      risk,
      question: next.verificationQuestion ?? null,
      transcript: prev?.transcript ?? [],
      history: prev?.history.length ? prev.history : [{ seq: 0, risk: next.risk, level: next.level, newTactics: next.tactics ?? [] }],
      agentStatus: next.agentStatus ?? 'idle',
      events: prev?.events ?? [],
    },
    prev,
  );
  if (!entry) return null;
  if (next.ended) {
    entry.running = false;
    entry.updatedAt = prev && !prev.running ? prev.updatedAt : Math.max(entry.startedAt, next.updatedAt);
  }
  return entry;
}

/** Writes one pushed phone call into the on-device log. */
export function rememberPushedCall(next: PushMessage): void {
  const list = loadCallLog();
  const i = list.findIndex((c) => c.callId === next.callId);
  const entry = mergePushedCall(i >= 0 ? list[i] : undefined, next);
  if (!entry) return;
  if (i >= 0) list[i] = entry;
  else list.unshift(entry);
  save(list);
}

/** Saves the current call into the log whenever it changes. Mount once, inside CallProvider. */
export function useCallLogRecorder(s: CallSnapshot) {
  useEffect(() => {
    if (!s.callId) return;
    const list = loadCallLog();
    const i = list.findIndex((c) => c.callId === s.callId);
    const entry = entryFor(s, i >= 0 ? list[i] : undefined);
    if (!entry) return;
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
    save(list);
  }, [s]);
}
