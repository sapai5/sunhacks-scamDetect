// E2 Call green. Figma node 15:22. risk.level === 'green'.
import { TextButton } from '../../components/Risk';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E2Green({ elapsed, onEnd }: CallScreenProps) {
  return (
    <CallLayout state="green" elapsed={elapsed}>
      {onEnd && <TextButton onClick={onEnd}>End call</TextButton>}
    </CallLayout>
  );
}
