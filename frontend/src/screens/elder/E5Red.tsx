// E5 Call red. Figma node 15:60 (and 15:80, the dark preview: same screen under data-theme="dark").
// risk.level === 'red'. risk.familyAlerted says the SMS went out.
import { BigButton } from '../../components/Risk';
import { RISK } from '../../lib/fixtures';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E5Red({ risk = RISK.red, elapsed, onEnd }: CallScreenProps) {
  return (
    <CallLayout state="red" elapsed={elapsed} panelBody={risk?.familyAlerted ? undefined : 'Hang up now.'}>
      <BigButton kind="hangup" onClick={onEnd}>
        Hang up
      </BigButton>
    </CallLayout>
  );
}
