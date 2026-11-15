// E1a Call listening. Figma node 15:11. Shown before the first analyze result arrives.
import { TextButton } from '../../components/Risk';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E1aListening({ elapsed, onEnd }: CallScreenProps) {
  return (
    <CallLayout state="listening" elapsed={elapsed}>
      {onEnd && <TextButton onClick={onEnd}>End call</TextButton>}
    </CallLayout>
  );
}
