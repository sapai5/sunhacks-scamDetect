// E5 Call red. Figma node 15:60 (and 15:80, the dark preview: same screen under data-theme="dark").
// risk.level === 'red'. risk.familyAlerted says the family alert went out.
// The app can't end the phone call, so the button is the elder confirming they hung up their phone.
import { BigButton } from '../../components/Risk';
import { RISK } from '../../lib/fixtures';
import { CallLayout, type CallScreenProps } from './CallLayout';

export default function E5Red({ risk = RISK.red, elapsed, onEnd }: CallScreenProps) {
  return (
    <CallLayout state="red" elapsed={elapsed} panelBody={risk?.familyAlerted ? undefined : 'Hang up your phone now.'}>
      <BigButton kind="hangup" onClick={onEnd}>
        I hung up
      </BigButton>
    </CallLayout>
  );
}
