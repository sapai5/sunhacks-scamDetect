// True when this build listens for phone calls the backend checks (Twilio / Connect -> IngestFn
// -> push socket). Then calls open on their own and "Start listening" is only for practice or a
// call that didn't come through the ScamDetermine number. Same switch as listenForPhoneCalls.
export const PHONE_PATH = Boolean(import.meta.env.VITE_PUSH_URL) && !new URLSearchParams(location.search).has('mock');
