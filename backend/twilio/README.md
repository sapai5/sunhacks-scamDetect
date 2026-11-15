# Twilio bridge (phone path while Connect waits for its number)

```
caller ──> Twilio number ──POST /voice──> this server
   trusted caller  → forwarded to the elder (<Dial>), nothing is streamed
   unknown caller  → both audio tracks stream to /media, then the call is forwarded to the elder
/media  → mu-law → PCM → Amazon Transcribe (caller track, elder track)
        → each sentence → IngestFn (Track B) → RiskState in Calls → pushed to the app
agent_takeover → the caller's call is redirected to the agent, which drops the elder's leg;
                 each Agent Lambda line is <Say> (Polly voice), then the agent waits for the reply
verified       → "Here she is", then the elder's phone rings again
scam confirmed → goodbye, hang up
```

Built to work on a **trial account**: no conferences, no inline TwiML, no `method` parameters,
and calls to the elder use the trial's assigned caller ID (`TWILIO_DIAL_FROM`). Our own TwiML URLs
(`/turn/…`, `/idle/…`) are authorized by a random per-call token in the path. `/voice` and
`/status` are checked against Twilio's signature.

The server runs on a laptop and is reachable through a tunnel. Detection, alerts and the agent
are the same deployed Lambdas the app uses, so switching to Amazon Connect later changes only
this front end (the contract is `IngestRequest`).

Test lines for two people: `docs/phone-test-script.md`.

## Setup

1. **Twilio trial:** sign up at twilio.com. Under *Phone Numbers → Manage → Verified Caller IDs*,
   verify the elder's phone and the caller's phone (trial accounts only connect verified numbers).
   Verifying has to happen in the console; the API can't do it on trial accounts.
2. **Number:** buy (free on trial) a voice number. Set its *A call comes in* webhook to
   `https://<tunnel>/voice` (POST) and *Call status changes* to `https://<tunnel>/status`.
3. **Tunnel:** `winget install Cloudflare.cloudflared`, then
   `cloudflared tunnel --url http://localhost:8080`. Copy the `https://….trycloudflare.com` URL.
4. **Config:** copy `backend/twilio/.env.example` to `backend/twilio/.env` (gitignored) and fill in
   the account SID, auth token, number, the trial's assigned number (`TWILIO_DIAL_FROM`, shown on
   the console's *Try out Voice* page) and the tunnel URL. The elder's phone and trusted contacts
   come from `backend/local.config.json`, also gitignored.
5. **Run:** `npm run twilio -w backend`.
6. **Call** the number from the verified caller phone. Trial accounts play a message and ask both
   sides to press a key.

Quick tunnels can expire without warning ("application error" on the call, nothing in the bridge
log). Restart cloudflared, update `PUBLIC_URL`, restart the bridge, and update both webhooks.

## Test without Twilio

```
# terminal 1: bridge in dry-run mode (no Twilio API calls, no signature check)
TWILIO_DRY_RUN=1 TWILIO_ACCOUNT_SID=ACdryrun TWILIO_AUTH_TOKEN=x TWILIO_NUMBER=+15555550100 PUBLIC_URL=http://localhost:8080 npm run twilio -w backend
# terminal 2: plays a test script as Polly audio over a fake Media Stream, then reads the Calls table
npm run twilio:sim -w backend -- grandparent-scam
```

Runs real Transcribe, Bedrock and alerts: red sims still email the family, because alerts go to the
shared SNS topic. Dry runs use `elderId: "sim"`, so they don't appear in the app; set `ELDER_ID=e-01`
when you want a sim on the demo phone. On PowerShell, set the variables with `$env:NAME='value';` first.

## Trial limits

75 voice minutes, 30 days, 10-minute calls, verified numbers only, a "press any key" message.
Upgrading removes them (paid to Twilio; AWS credits don't cover it) and would allow a conference,
so the elder could stay on the line and hear the agent.

## Status

- Real calls: forwarding, both tracks, scoring, red and the family alert work (tested).
- Not verified on a real call yet: the takeover redirect, whether the media stream keeps running
  after it, and the hand-back re-dial.
