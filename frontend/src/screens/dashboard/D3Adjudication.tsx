// D3 Bedrock adjudication. Figma node 15:354. Static: Bedrock's reason and verdict for the window.
// Figma frames this as "engine unsure, asking Bedrock"; in Stage 1 every analyze call goes to Bedrock.
import { SNAPSHOT_ADJUDICATE } from '../../lib/fixtures';
import { LiveDashboard } from './LiveDashboard';

export default function D3Adjudication() {
  return <LiveDashboard call={SNAPSHOT_ADJUDICATE} card="verdict" />;
}
