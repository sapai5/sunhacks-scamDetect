// A serialisable picture of the call, shared between tabs with BroadcastChannel so the
// desktop dashboard (one tab / laptop window) mirrors the elder phone view (another tab).
import { useEffect, useRef, useState } from 'react';
import type { AgentStatus, CallEvent, RiskState, Tactic, Utterance, Verification } from '../../../contracts/index.js';
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
  /** Hang-up / speaker events, oldest first. `notified` = the family was alerted about it. */
  events: LoggedEvent[];
}

export type LoggedEvent = CallEvent & { notified?: boolean };

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
  events: [],
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
  // Open the channel inside an effect (not useState): React StrictMode runs effects twice in dev,
  // and a channel created once but closed by the first cleanup would throw on every post.
  const ch = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    ch.current = channel();
    return () => {
      ch.current?.close();
      ch.current = null;
    };
  }, []);
  useEffect(() => {
    if (!s.callId) return;
    try {
      ch.current?.postMessage(s);
    } catch {
      /* mirroring is best effort; never break the call over it */
    }
  }, [s]);
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
