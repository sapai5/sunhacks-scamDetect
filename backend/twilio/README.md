# Twilio bridge (phone path while Connect waits for its number)

```
caller ──> Twilio number ──POST /voice──> this server
   trusted caller  → rings the elder directly, nothing is streamed
   unknown caller  → both audio tracks stream to /media, caller + elder join one conference
/media  → mu-law → PCM → Amazon Transcribe (caller track, elder track)
        → each sentence → IngestFn (Track B) → RiskState in Calls → pushed to the app
agent_takeover → Agent Lambda → line spoken into the conference (Twilio <Say>, Polly voice)
scam confirmed → goodbye, then the call is ended for everyone
```

The server runs on a laptop and is reachable through a tunnel. Detection, alerts and the agent
are the same deployed Lambdas the app uses, so switching to Amazon Connect later changes only
this front end (the contract is `IngestRequest`).

## Setup (about 20 min)

1. **Twilio trial:** sign up at twilio.com, get the free number. Under
   *Phone Numbers → Verified Caller IDs*, verify the phone that will call in (a teammate) and the
   elder's phone (your iPhone). Trial accounts only connect verified numbers.
2. **Tunnel:** `winget install Cloudflare.cloudflared`, then
   `cloudflared tunnel --url http://localhost:8080`. Copy the `https://….trycloudflare.com` URL.
3. **Config:** copy `backend/twilio/.env.example` to `backend/twilio/.env` (gitignored) and fill in
   the account SID, auth token, Twilio number and tunnel URL. The elder's phone and trusted contacts
   come from `backend/local.config.json`, also gitignored.
4. **Run:** `npm run twilio -w backend`. It prints the webhook URLs.
5. **Point the number at it:** Twilio console → your number → *Voice configuration* →
   *A call comes in*: Webhook, `https://<tunnel>/voice`, HTTP POST. *Call status changes*:
   `https://<tunnel>/status`.
6. **Call it** from the verified phone. Trial accounts play a message and ask the caller to press a
   key; the elder's phone gets the same when it rings.

The quick tunnel URL changes every time cloudflared restarts: update `PUBLIC_URL` and the Twilio
webhook when it does. Webhooks are checked against Twilio's signature, so only Twilio can call them.

## Test without Twilio

```
# terminal 1: bridge in dry-run mode (no Twilio API calls, no signature check)
TWILIO_DRY_RUN=1 TWILIO_ACCOUNT_SID=ACdryrun TWILIO_AUTH_TOKEN=x TWILIO_NUMBER=+15555550100 PUBLIC_URL=http://localhost:8080 npm run twilio -w backend
# terminal 2: plays a test script as Polly audio over a fake Media Stream, then reads the Calls table
npm run twilio:sim -w backend -- grandparent-scam
```

Runs real Transcribe, Bedrock and alerts (the family email gets messages). On PowerShell, set the
variables with `$env:NAME='value';` first.

## Trial limits

75 voice minutes, 30 days, 10-minute calls, verified numbers only, a "press any key" message.
Upgrading removes them (paid to Twilio; AWS credits don't cover it).

## Not verified on a real Twilio call yet

- That the conference announcement plays to both sides as expected, and how long Twilio takes to
  start it (the mic is muted on the elder track for an estimate of the speaking time).
- The trial "press any key" prompt on the elder's leg before the conference.
- The elder can't take the call back from the agent ("Let me talk") on the phone path yet.
