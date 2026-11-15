// Hang-up and speakerphone detection for the live call.
//
// Signals                                    -> event (POST /events)        -> elder prompt
// mic: voice-like audio stops for 12 s       -> speaker_off  (audio)        -> "We can't hear the caller"
// mic: audio comes back                      -> speaker_on   (audio)        -> (prompt clears)
// mic: dial / busy tone                      -> (ask first)                 -> "Did the call end?" auto-ends in 8 s
// mic: 30 s of silence                       -> (ask first)                 -> "Did the call end?" auto-ends in 15 s
// caller: "take me off speaker", "are you alone?" -> off_speaker_requested (transcript) -> "Keep them on speaker"
// elder: Hang up / "I hung up" / "Yes, it ended"  -> hangup (elder)
//
// The backend texts the family when it matters (off speaker during a risky call; hang-up on a
// red call). In demo mode, `simulate` feeds fake audio events.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallEventSource, CallEventType } from '../../../contracts/index.js';
import { vibrate } from './alerts';
import { postEvent } from './api';
import { AudioPresence, OFF_SPEAKER_REQUEST, type PresenceEvent } from './presence';
import type { LoggedEvent } from './snapshot';
import type { CallController } from './useCall';

export type CallPrompt =
  | { kind: 'keep_on_speaker'; detail: string }
  | { kind: 'speaker_check'; detail: string }
  | { kind: 'hangup_check'; detail: string; autoEndAt: number };

const TONE_AUTO_END_MS = 8_000;
const SILENCE_AUTO_END_MS = 15_000;

export function useCallEvents(call: CallController) {
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [prompt, setPrompt] = useState<CallPrompt | null>(null);
  const callRef = useRef(call);
  callRef.current = call;
  const st = useRef({
    detector: new AudioPresence(),
    reported: new Set<CallEventType>(),
    speakerOff: false,
    autoEnd: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  const report = useCallback(
    (type: CallEventType, source: CallEventSource, detail?: string) => {
      const s = st.current;
      const c = callRef.current.latest();
      if (!c.callId) return;
      // One hang-up and one off-speaker request per call; speaker off/on alternate.
      if ((type === 'hangup' || type === 'off_speaker_requested') && s.reported.has(type)) return;
      if (type === 'speaker_off' && s.speakerOff) return;
      if (type === 'speaker_on' && !s.speakerOff) return;
      s.reported.add(type);
      if (type === 'speaker_off') s.speakerOff = true;
      if (type === 'speaker_on') s.speakerOff = false;

      const ev: LoggedEvent = { callId: c.callId, type, source, level: c.risk?.level ?? 'green', at: Date.now(), detail };
      setEvents((list) => [...list, ev]);
      void postEvent(ev).then(({ notified }) => {
        if (notified) setEvents((list) => list.map((e) => (e === ev ? { ...e, notified } : e)));
      });
    },
    [],
  );

  const clearAutoEnd = () => {
    clearTimeout(st.current.autoEnd);
    st.current.autoEnd = undefined;
  };

  /** The call is over: record it and stop listening (the live screen then shows the summary). */
  const endCall = useCallback(
    (source: CallEventSource, detail?: string) => {
      clearAutoEnd();
      setPrompt(null);
      report('hangup', source, detail);
      callRef.current.stop();
    },
    [report],
  );

  const onPresence = useCallback(
    (e: PresenceEvent) => {
      switch (e.type) {
        case 'voice_lost':
          report('speaker_off', 'audio', e.detail);
          setPrompt((p) => (p?.kind === 'hangup_check' ? p : { kind: 'speaker_check', detail: e.detail }));
          vibrate(200);
          break;
        case 'voice_back':
          report('speaker_on', 'audio', e.detail);
          setPrompt((p) => (p?.kind === 'speaker_check' || p?.kind === 'hangup_check' ? null : p));
          clearAutoEnd();
          break;
        case 'tone':
        case 'long_silence': {
          const wait = e.type === 'tone' ? TONE_AUTO_END_MS : SILENCE_AUTO_END_MS;
          clearAutoEnd();
          setPrompt({ kind: 'hangup_check', detail: e.detail, autoEndAt: Date.now() + wait });
          st.current.autoEnd = setTimeout(() => endCall('audio', e.detail), wait);
          vibrate([150, 100, 150]);
          break;
        }
      }
    },
    [report, endCall],
  );

  // New call: fresh detector and log.
  useEffect(() => {
    clearAutoEnd();
    st.current = { detector: new AudioPresence(), reported: new Set(), speakerOff: false, autoEnd: undefined };
    setEvents([]);
    setPrompt(null);
  }, [call.callId]);

  // Call stopped some other way (Hang up button, End call): drop any pending prompt.
  useEffect(() => {
    if (!call.running) {
      clearAutoEnd();
      setPrompt(null);
    }
  }, [call.running]);

  // Mic audio -> detector.
  useEffect(
    () =>
      call.subscribeAudio((chunk, sampleRate) => {
        for (const e of st.current.detector.push(chunk, sampleRate)) onPresence(e);
      }),
    [call.subscribeAudio, onPresence],
  );

  // Caller lines -> "take me off speaker" / "are you alone?"
  useEffect(
    () =>
      call.subscribeLines((text) => {
        if (!OFF_SPEAKER_REQUEST.test(text)) return;
        report('off_speaker_requested', 'transcript', `“${text.slice(0, 80)}”`);
        setPrompt((p) => p ?? { kind: 'keep_on_speaker', detail: text });
        vibrate([100, 60, 100]);
      }),
    [call.subscribeLines, report],
  );

  return {
    events,
    prompt,
    /** Elder tapped Hang up / End call. */
    hangUp: () => endCall('elder', 'Elder ended the call'),
    /** Elder answered a prompt. */
    confirmEnded: () => endCall('elder', 'Elder confirmed the call ended'),
    stillOnSpeaker: () => {
      clearAutoEnd();
      st.current.detector.reset();
      setPrompt(null);
      report('speaker_on', 'elder', 'Elder confirmed it is on speaker');
    },
    dismiss: () => setPrompt(null),
    /** Demo / testing: pretend the mic heard something. */
    simulate: (type: PresenceEvent['type']) =>
      onPresence({
        type,
        detail: { voice_lost: 'No caller audio for 12 s', voice_back: 'Caller audio is back', tone: 'Dial tone heard', long_silence: 'Silent for 30 s' }[type],
      }),
  };
}

export type CallEventsController = ReturnType<typeof useCallEvents>;
