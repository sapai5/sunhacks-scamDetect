// Call log: every call this phone showed (speakerphone, demo or pushed phone call), with its
// transcript, kept in this browser only. Saved as the call goes, so a crash or a closed tab still
// leaves the call in the log. Capped to the latest MAX_CALLS calls and MAX_AGE_DAYS days.
//
// Phone-path calls (pushed over the socket) only carry risk results, not sentences, so their
// entries have no transcript until the backend sends one.
import { useEffect } from 'react';
import type { AgentStatus, Level, RiskState, Tactic, Utterance } from '../../../contracts/index.js';
import type { CallSnapshot, LoggedEvent, RiskPoint } from './snapshot';

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
    familyAlerted: Boolean(s.risk?.familyAlerted || prev?.familyAlerted),
    agentStatus: s.agentStatus,
    // Keep what we already had if this snapshot carries less (e.g. a phone call after a reload).
    transcript: s.transcript.length >= (prev?.transcript.length ?? 0) ? s.transcript : prev!.transcript,
    history: s.history.length >= (prev?.history.length ?? 0) ? s.history : prev!.history,
    events: s.events.length >= (prev?.events.length ?? 0) ? s.events : prev!.events,
  };
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
