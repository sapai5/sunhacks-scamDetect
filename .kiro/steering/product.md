# Scam Shield product decisions

Decisions made by the team. Follow them in all stages unless the team changes them.

## Which calls are screened
- Only calls from numbers that are NOT in the elder's contacts are screened. Calls from contacts ring through untouched.
- Stage 1 (speakerphone) cannot see the caller's number, so the elder starts the app herself on unknown calls; the app says so on screen.
- Stage 2 (Amazon Connect) must enforce this automatically: the contact flow compares the caller ID with the elder's `trustedContacts` (Elders table) and, on a match, transfers straight to the elder's phone without media streaming, transcription or analysis.

## Family alert
- The family is alerted once, when the call is red AND the elder starts falling for it (`elderState` engaging or complying). Red alone, with the elder not going along, only changes the light.
- Channel this weekend: SNS email (`familyEmail`). US SMS needs a registered toll-free/10DLC number (up to 15 business days), so it's deferred.

## Agent takeover
- The agent takes over only in a clear case: call is red AND the elder is complying (agreeing to pay, buying cards, reading numbers, installing software). Once per call; never again after the elder taps "Let me talk".
- The agent speaks as a family member (configured `agentName` / `agentRelation`, default "Mike, her son"), not as an AI assistant. It must not claim to be the person the caller is impersonating.
- The agent verifies the caller (family question for claimed relatives, callback number for organizations), never agrees to pay, never shares the elder's information, and ends with verified / scam_confirmed / caller_left. The family gets a follow-up summary.
- A caller the agent verified can't push the call back to red; it stays at yellow at most.
- Voice: the browser's built-in speech synthesis for now (no Polly).
