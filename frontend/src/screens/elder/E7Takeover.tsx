// E7 Family takeover (not in Figma yet). Shown once the agent takes over the call:
// the elder was clearly falling for a scam, so the laptop speaks as a family member.
import type { AgentStatus } from '../../../../contracts/index.js';
import { BigButton, SpeakingPill, TextButton } from '../../components/Risk';
import { CallLayout, type CallScreenProps } from './CallLayout';

export interface E7Props extends CallScreenProps {
  agentStatus?: AgentStatus;
  speaking?: boolean;
  summary?: string;
  /** "Let me talk": the elder takes the call back. */
  onTakeBack?: () => void;
}

const COPY: Partial<Record<AgentStatus, { title: string; body: string }>> = {
  active: { title: 'Your family is taking this call', body: "Stay quiet and don't hang up yet." },
  scam_confirmed: { title: 'Hang up now', body: 'This is a scam. Your family has been told. Do not call this number back.' },
  caller_left: { title: 'The caller left', body: 'You can hang up. Your family has been told.' },
};

export default function E7Takeover({ agentStatus = 'active', speaking = true, summary, elapsed, onEnd, onTakeBack }: E7Props) {
  const copy = COPY[agentStatus] ?? COPY.active!;
  const body = agentStatus === 'caller_left' && summary ? summary : copy.body;
  return (
    <CallLayout state="red" elapsed={elapsed} panelTitle={copy.title} panelBody={body}>
      {agentStatus === 'active' && (
        <>
          <SpeakingPill>{speaking ? 'Mike is talking to the caller' : 'Listening to the caller'}</SpeakingPill>
          {onTakeBack && (
            <BigButton kind="secondary" onClick={onTakeBack}>
              Let me talk
            </BigButton>
          )}
          {onEnd && <TextButton onClick={onEnd}>End call</TextButton>}
        </>
      )}
      {agentStatus !== 'active' && (
        <BigButton kind="hangup" onClick={onEnd}>
          Hang up
        </BigButton>
      )}
    </CallLayout>
  );
}
