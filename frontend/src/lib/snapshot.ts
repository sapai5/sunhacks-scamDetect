// A serialisable picture of the call, shared between tabs with BroadcastChannel so the
// desktop dashboard (one tab / laptop window) mirrors the elder phone view (another tab).
import { useEffect, useState } from 'react';
import type { AgentStatus, RiskState, Tactic, Utterance, Verification } from '../../../contracts/index.js';
import type { ElderView } from './callState';

/** One analyze result, tied to the utterance that triggered it. */
export interface RiskPoint {
  seq: number;
  risk: number;
  level: RiskState['level'];
  /** Tactics that first appeared at this point. */
  newTactics: Tactic[];
  /** Set when the point came from the elder answering the family question. */
  note?: string;
}

export interface CallSnapshot {
  callId: string;
  running: boolean;
  startedAt: number | null;
  risk: RiskState | null;
  view: ElderView;
  verification: Verification;
  /** Last verification question the backend asked (kept after the action clears). */
  question: string | null;
  transcript: Utterance[];
  history: RiskPoint[];
  latencyMs: number | null;
  p95Ms: number | null;
  /** Where the takeover agent is ('idle' = never took over). */
  agentStatus: AgentStatus;
}

export const EMPTY_SNAPSHOT: CallSnapshot = {
  callId: '',
  running: false,
  startedAt: null,
  risk: null,
  view: 'listening',
  verification: 'unasked',
  question: null,
  transcript: [],
  history: [],
  latencyMs: null,
  p95Ms: null,
  agentStatus: 'idle',
};

const CHANNEL = 'scamdetermine-call';

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/** Publish this tab's call so other tabs can mirror it. */
export function usePublishSnapshot(s: CallSnapshot) {
  const [ch] = useState(channel);
  useEffect(() => {
    if (s.callId) ch?.postMessage(s);
  }, [ch, s]);
  useEffect(() => () => ch?.close(), [ch]);
}

/** The most recent call seen in any tab (this one included). */
export function useMirroredSnapshot(local: CallSnapshot): CallSnapshot {
  const [remote, setRemote] = useState<CallSnapshot | null>(null);
  useEffect(() => {
    const ch = channel();
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<CallSnapshot>) => setRemote(e.data);
    return () => ch.close();
  }, []);
  if (local.callId && (local.running || !remote?.running)) return local;
  return remote ?? local;
}
