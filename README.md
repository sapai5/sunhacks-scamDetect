# Elder Scam Call Shield: Stage 1

Speakerphone call → browser mic → Amazon Transcribe → Analyze Lambda → Bedrock (Claude Haiku) → green / yellow / red light. Red texts the family via SNS.

```
frontend/   PWA (Vite, vanilla TS). Mic → Transcribe streaming, light, meter, chips, verification card.
backend/    CDK stack ScamShieldStage1
  lambda/credentials   STS AssumeRole → 15-min creds allowed only to open a Transcribe stream
  lambda/analyze       validate → last 60 s → Bedrock → level rules (rules.ts) → SNS on red
  scripts/             4 test scripts, a runner against the deployed Lambda, deploy helpers
contracts/  Shared TypeScript types (Utterance, AnalyzeRequest, RiskState)
```

## AWS resources

| Component | Resource | Notes |
|---|---|---|
| Web app | Amplify Hosting app `scam-shield`, branch `main` | Manual zip deploys, no Git connection |
| Live transcription | Transcribe streaming (called from the browser) | Nothing to provision |
| Credentials Lambda | Function URL + `BrowserTranscribeRole` | Role allows only `transcribe:StartStreamTranscriptionWebSocket`. Replaces the Cognito identity pool from the doc, same effect, less setup |
| Analyze Lambda | Function URL, Node 22 arm64, 15 s timeout | Role: `bedrock:InvokeModel` on Claude models, `sns:Publish` on the family topic |
| Family alert | SNS topic `FamilyAlerts` with SMS (and optional email) subscription | Texts only on the transition into red |

Elder settings (name, verification question, family phone, model) are CDK context in `backend/cdk.json`, passed to the Lambda as environment variables.

## Setup (hour 1)

1. AWS credentials for the team account (`aws configure` or env vars). Region defaults to `us-east-1` in `backend/cdk.json`.
2. Bedrock console → Model access → enable **Claude Haiku 4.5** (or change `modelId`, e.g. `us.anthropic.claude-3-5-haiku-20241022-v1:0`).
3. SMS: new accounts are in the SMS sandbox. In the SNS console → Text messaging (SMS) → add and verify the family phone number. Set `familyPhone` (E.164, `+1...`) in `backend/cdk.json`. Set `familyEmail` as a fallback if SMS isn't ready.
4. `npm install`
5. `cd backend && npx cdk bootstrap` (once per account/region)

## Deploy and run

```
cd backend
npm run deploy              # cdk deploy, writes cdk-outputs.json and frontend/.env.local
npm run scripts:run         # plays the 4 test scripts against the real Lambda (red ones send SMS)
cd ../frontend
npm run dev                 # local; open on the laptop
npm run build && npm run deploy:web -w backend   # push to Amplify, URL printed
```

The mic needs HTTPS (or localhost). On an iPhone use the Amplify URL, then Share → Add to Home Screen.

`npm test` runs the level-rule unit tests (no AWS needed).

## Known Stage 1 shortcuts

- Both function URLs are public (`authType: NONE`) with CORS `*`. Anyone with the Analyze URL can trigger Bedrock calls and family texts. Lock CORS to the Amplify domain after first deploy; Cognito comes in Stage 3.
- One elder, hardcoded. `elderId` is always `e-01`.
- Transcribe gets one mixed channel from the speakerphone, so every line is labeled `caller`.
