// E7 Family takeover (not in Figma yet). Shown once the agent takes over the call:
// the elder was clearly falling for a scam, so the agent speaks to the caller as a family member
// (through this device's speaker on the speakerphone path, inside the call on the phone path).
// Copy works for both paths: on a phone call the server may end the call itself.
import type { AgentStatus } from '../../../../contracts/index.js';
import { BigButton, SpeakingPill, TextButton } from '../../components/Risk';
import { CallLayout, type CallScreenProps } from './CallLayout';

export interface E7Props extends CallScreenProps {
  agentStatus?: AgentStatus;
  speaking?: boolean;
  summary?: string;
  /** "Let me talk": the elder takes the call back. */
  onTakeBack?: () => void;
  /** The agent's persona name (cdk.json agentName). */
  agentName?: string;
}

const COPY: Partial<Record<AgentStatus, { title: string; body: string }>> = {
  active: { title: 'Your family is taking this call', body: "Stay on the line and stay quiet. Don't share any numbers or codes." },
  scam_confirmed: { title: 'This is a scam', body: "Hang up if the call is still on. Your family has been told. Don't call this number back." },
  caller_left: { title: 'The caller left', body: 'You can hang up. Your family has been told.' },
};

export default function E7Takeover({ agentStatus = 'active', speaking = true, summary, elapsed, onEnd, onTakeBack, agentName = 'Mike' }: E7Props) {
  const copy = COPY[agentStatus] ?? COPY.active!;
  const body = agentStatus === 'caller_left' && summary ? summary : copy.body;
  return (
    <CallLayout state="red" elapsed={elapsed} panelTitle={copy.title} panelBody={body}>
      {agentStatus === 'active' && (
        <>
          <SpeakingPill>{speaking ? `${agentName} is talking to the caller` : `${agentName} is listening to the caller`}</SpeakingPill>
          {onTakeBack && (
            <BigButton kind="secondary" onClick={onTakeBack}>
              Let me talk
            </BigButton>
          )}
          {onEnd && <TextButton onClick={onEnd}>I hung up</TextButton>}
        </>
      )}
      {agentStatus !== 'active' && (
        <BigButton kind="hangup" onClick={onEnd}>
          I hung up
        </BigButton>
      )}
    </CallLayout>
  );
}
