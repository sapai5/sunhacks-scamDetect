# Elder Scam Call Shield: Stage 1

Speakerphone call → browser mic → Amazon Transcribe → Analyze Lambda → Bedrock (Claude Haiku) → green / yellow / red light.
When the call is red and the elder starts going along with it, the family gets an email. When she's clearly falling for it, an agent posing as a family member takes over the call through the laptop speaker, checks the caller, and either hands the call back or ends it.

Product decisions (which calls are screened, when to alert, when the agent takes over) are in `.kiro/steering/product.md`.

```
frontend/   React PWA (Vite) built from the Figma screens. See frontend/README.md.
backend/    CDK stacks ScamShieldStage1 (lib/stage1-stack.ts) and ScamShieldData (lib/data-stack.ts)
  lambda/credentials   STS AssumeRole → 15-min creds allowed only to open a Transcribe stream
  lambda/analyze       validate → last 60 s → Bedrock → level rules (rules.ts) → SNS alert; scoring in score.ts
  lambda/agent         transcript → Bedrock as the family persona → guards (rules.ts) → next line + status
  lambda/settings      Settings API: onboarding writes the Elders table
  lambda/ingest        phone path: one sentence → Calls table → same scoring as analyze → saved RiskState
  lambda/push          WebSocket $connect + Calls stream → each new RiskState to the elder's open sockets
  scripts/             test scripts, a runner (deployed, --ingest or --local), deploy and check helpers
contracts/  Shared TypeScript types (Utterance, AnalyzeRequest, RiskState, AgentRequest, AgentResponse, IngestRequest, ElderSettings)
```

## AWS resources

| Component | Resource | Notes |
|---|---|---|
| Web app | Amplify Hosting app `scam-shield`, branch `main` | Manual zip deploys, no Git connection |
| Live transcription | Transcribe streaming (called from the browser) | Speaker labels on. Nothing to provision |
| Credentials Lambda | Function URL + `BrowserTranscribeRole` | Role allows only `transcribe:StartStreamTranscriptionWebSocket`. Replaces the Cognito identity pool from the doc, same effect, less setup |
| Analyze Lambda | Function URL, Node 22 arm64, 15 s timeout | Role: `bedrock:InvokeModel` on Claude models, `sns:Publish` on the family topic |
| Agent Lambda | Function URL, Node 22 arm64, 15 s timeout | Same permissions. Only this function uses the verification answer (Analyze and Ingest can read the Elders item but never send it out) |
| Events Lambda | Function URL, 5 s timeout | Call events (hang-up, off/on speaker, caller asking to go off speaker). Alerts the family when a risky call goes off speaker, and after a hang-up on red |
| Family alert | SNS topic `FamilyAlerts` with email (and optional SMS) subscription | Alert when red + elder engaging; summary when the agent finishes |
| Elders table | DynamoDB `ScamShieldElders` (Data stack) | One item per elder: settings, trusted contacts, open push sockets. `e-01` is seeded from `cdk.json` on first deploy |
| Calls table | DynamoDB, 24 h TTL, stream on | Phone-path call state: transcript, last RiskState, verification, alert and agent flags |
| Settings Lambda | Function URL (GET/PUT) | GET never returns the verification answer. Only seeded elders can be updated |
| Ingest Lambda | Direct invoke only | Track A's transcriber calls it per sentence (`IngestRequest`). Alerts once per call via a conditional write. Runs the phone agent (same code as the Agent Lambda) once `phoneSpeakFn` in `cdk.json` names Track A's Lambda that speaks `{ callId, text }` into the call (`log` = dry run, nothing is heard). Until then a takeover result is only pushed to the app and scoring continues. Leave it empty with the Twilio bridge, which runs the agent itself |
| Push | API Gateway WebSocket (`wss://…/live?elderId=e-01`) + Push Lambda on the Calls stream | Sends each change as a `PushMessage` (RiskState plus phone agent status and latest line). The app sends `{action: 'stopAgent', callId}` for "Let me talk". Rejects origins outside the CORS list |

Elder settings (name, verification question and answer, agent persona) live in the Elders table; onboarding saves them through the Settings API. The Analyze, Agent and Ingest Lambdas read them on each request and fall back to the `backend/cdk.json` values (passed as env vars) if the table or item is missing. Alerts still go to the SNS topic's subscribers (`familyEmail`). The values in the repo are demo data.

## Setup

1. AWS credentials for the team account (`~/.aws/credentials` or env vars). Check with `npx tsx scripts/whoami.ts` in `backend/`.
2. Bedrock access to **Claude Haiku 4.5**. Check with `npx tsx scripts/check-bedrock.ts`.
3. Set `familyEmail` in `backend/cdk.json`. After deploying, click the confirmation link SNS emails you. (US SMS needs a registered sending number, which takes up to 15 business days, so email is the channel for now.)
4. `npm install`
5. `cd backend && npx cdk bootstrap` (once per account/region)

## Deploy and run

```
cd backend
npm run deploy              # cdk deploy --all, writes cdk-outputs.json and frontend/.env.local
npm run scripts:run         # plays the test scripts against the real Lambdas (sends real alert emails)
npm run scripts:run -- --ingest   # same lines through IngestFn (phone path); levels should match
npm run scripts:run -- --local    # scoring + agent code run locally against Bedrock: no deploy, no emails (prompt tuning)
npx wscat -c "<PushUrl>?elderId=e-01" -o http://localhost:5173   # watch pushed RiskStates while --ingest runs
cd ../frontend
npm run dev                 # local; open on the laptop
npm run build && npm run deploy:web -w backend   # push to Amplify, URL printed
```

The mic needs HTTPS (or localhost). On an iPhone use the Amplify URL, then Share → Add to Home Screen.
Demo mode plays a test script through the whole flow, including the agent speaking and scripted caller replies, without a mic.

`npm test` runs the rule unit tests (no AWS needed).

## Known Stage 1 shortcuts

- All function URLs are public (`authType: NONE`). CORS (and the push socket's origin check) only allows the Amplify app and `webOrigins` in `cdk.json` (localhost), but that only stops browsers: anyone with a URL can still call it with curl, including the Settings PUT and subscribing to an elder's push socket. Cognito comes in Stage 3.
- IngestFn: two sentences that overlap are scored from the same previous state (the newer result wins). SQS FIFO per call (Stage 3) would serialize them.
- One elder, hardcoded. `elderId` is always `e-01`.
- The app can't see the caller's number, so "only unknown numbers" relies on the elder starting it. Stage 2 (Connect) checks caller ID against `trustedContacts`.
- The agent speaks through the laptop speaker into the speakerphone, so the caller hears it at speakerphone quality. The mic is muted (silence sent) while it speaks.
