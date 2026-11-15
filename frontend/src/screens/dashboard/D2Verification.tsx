// D2 Verification moment. Figma node 15:271. Static: the caller fails the family question.
import { SNAPSHOT_VERIFY } from '../../lib/fixtures';
import { LiveDashboard } from './LiveDashboard';

export default function D2Verification() {
  return <LiveDashboard call={SNAPSHOT_VERIFY} card="verify" />;
}
