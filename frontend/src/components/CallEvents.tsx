// Hang-up / speakerphone components (not in Figma yet; styled like StatusPanel and VerifyCard).
//   CallEventSheet  elder phone: one question, one tap ("We can't hear the caller", "Did the call end?")
//   EventTimeline   dashboard: what was detected, by what, and whether the family was texted
import { useEffect, useState } from 'react';
import type { CallEventType } from '../../../contracts/index.js';
import type { LoggedEvent } from '../lib/snapshot';
import type { CallPrompt } from '../lib/useCallEvents';
import { BigButton, clock } from './Risk';
import './components.css';

const SHEET_COPY: Record<CallPrompt['kind'], { title: string; body: string }> = {
  keep_on_speaker: {
    title: 'Keep them on speaker',
    body: 'The caller wants you to take them off speaker. Scammers do this so nobody else can hear. Leave it on speaker.',
  },
  speaker_check: {
    title: "We can't hear the caller",
    body: 'Is the call still on speaker? ScamDetermine can only protect you when it can hear the call.',
  },
  hangup_check: {
    title: 'Did the call end?',
    body: 'It sounds like the call is over.',
  },
};

export interface CallEventSheetProps {
  prompt: CallPrompt;
  onStillOnSpeaker: () => void;
  onEnded: () => void;
  onDismiss: () => void;
}

/** Bottom sheet over the call screen. Big targets, one decision. */
export function CallEventSheet({ prompt, onStillOnSpeaker, onEnded, onDismiss }: CallEventSheetProps) {
  const copy = SHEET_COPY[prompt.kind];
  const secondsLeft = useCountdown(prompt.kind === 'hangup_check' ? prompt.autoEndAt : null);
  return (
    <div className="event-sheet" role="alertdialog" aria-labelledby="event-sheet-title" data-kind={prompt.kind}>
      <p id="event-sheet-title" className="event-sheet__title">
        {copy.title}
      </p>
      <p className="event-sheet__body">
        {copy.body}
        {prompt.kind === 'hangup_check' && secondsLeft !== null && ` Ending in ${secondsLeft} s.`}
      </p>
      {prompt.kind === 'keep_on_speaker' ? (
        <BigButton kind="primary" onClick={onDismiss}>
          OK, it stays on speaker
        </BigButton>
      ) : (
        <div className="event-sheet__actions">
          <BigButton kind="primary" onClick={onStillOnSpeaker}>
            {prompt.kind === 'hangup_check' ? 'No, still talking' : "Yes, it's on speaker"}
          </BigButton>
          <BigButton kind="secondary" onClick={onEnded}>
            {prompt.kind === 'hangup_check' ? 'Yes, it ended' : 'I hung up'}
          </BigButton>
        </div>
      )}
    </div>
  );
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
}

const EVENT_LABEL: Record<CallEventType, string> = {
  hangup: 'Call ended',
  speaker_off: 'Caller not heard (off speaker?)',
  speaker_on: 'Back on speaker',
  off_speaker_requested: 'Caller asked to go off speaker',
};
const SOURCE_LABEL = { elder: 'elder tapped', audio: 'heard by mic', transcript: 'in transcript' } as const;

/** Dashboard card: call events in order. Hidden until something happens. */
export function EventTimeline({ events, startedAt }: { events: LoggedEvent[]; startedAt: number }) {
  if (!events.length) return null;
  return (
    <div className="event-timeline">
      <p className="eyebrow">Call events</p>
      <ol className="event-timeline__list">
        {events.map((e, i) => (
          <li key={i} className="event-timeline__item" data-type={e.type}>
            <span className="event-timeline__time">{clock(Math.max(0, (e.at - startedAt) / 1000))}</span>
            <span className="event-timeline__dot" aria-hidden="true" />
            <span className="event-timeline__text">
              <b>{EVENT_LABEL[e.type]}</b>
              <span className="event-timeline__meta">
                {SOURCE_LABEL[e.source]} · {e.level}
                {e.detail ? ` · ${e.detail}` : ''}
                {e.notified ? ' · family texted' : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
