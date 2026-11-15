// F1 SMS alert. Figma node 15:120.
// A mock of the family's phone for the demo. The real alert is an SNS text sent by the
// Analyze Lambda (backend/lambda/analyze/index.ts, alertFamily); its wording differs.
import { SmsBubble } from '../../components/Risk';
import { SAMPLE_CALLER } from '../../lib/fixtures';

export interface F1Props {
  elderName?: string;
  /** e.g. "asks for gift cards, says keep it secret" */
  signs?: string;
  time?: string;
}

export default function F1SmsAlert({ elderName = 'Mom', signs = 'asks for gift cards, says keep it secret', time = 'Today 4:12 PM' }: F1Props) {
  return (
    <div className="screen-sms">
      <p className="sms-title">Messages</p>
      <p className="sms-time">{time}</p>
      <SmsBubble>
        ScamDetermine RED ALERT: {elderName} is on a call with {SAMPLE_CALLER.number} that looks like a scam ({signs}). Transcript: sd.link/c/4821
      </SmsBubble>
    </div>
  );
}
