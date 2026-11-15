// E3 Call yellow. Figma node 15:33. risk.level === 'yellow' (no family question pending).
import { TextButton } from '../../components/Risk';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E3Yellow({ elapsed, onEnd }: CallScreenProps) {
  return (
    <CallLayout state="yellow" elapsed={elapsed}>
      {onEnd && <TextButton onClick={onEnd}>End call</TextButton>}
    </CallLayout>
  );
}
