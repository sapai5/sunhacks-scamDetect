// D1 Live call. Figma node 15:187.
// Live: mirrors whatever call is running in this tab or any other tab (BroadcastChannel),
// so open the elder view on one screen and this on the laptop. Falls back to sample data.
import { useEffect, useState } from 'react';
import { useCallContext } from '../../lib/CallContext';
import { SNAPSHOT_LIVE } from '../../lib/fixtures';
import { useMirroredSnapshot } from '../../lib/snapshot';
import { LiveDashboard } from './LiveDashboard';

export default function D1LiveCall() {
  const local = useCallContext().snapshot;
  const call = useMirroredSnapshot(local);
  const now = useNow(call.running);
  return call.callId ? <LiveDashboard call={call} now={now} /> : <LiveDashboard call={SNAPSHOT_LIVE} />;
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}
