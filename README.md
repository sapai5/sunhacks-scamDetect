# Elder Scam Call Shield: Stage 1

Speakerphone call → browser mic → Amazon Transcribe → Analyze Lambda → Bedrock (Claude Haiku) → green / yellow / red light.
When the call is red and the elder starts going along with it, the family gets an email. When she's clearly falling for it, an agent posing as a family member takes over the call through the laptop speaker, checks the caller, and either hands the call back or ends it.

Product decisions (which calls are screened, when to alert, when the agent takes over) are in `.kiro/steering/product.md`.

```
frontend/   PWA (Vite, vanilla TS). Mic → Transcribe streaming, light, meter, chips, verification card, takeover panel, built-in speech for the agent.
backend/    CDK stack ScamShieldStage1
  lambda/credentials   STS AssumeRole → 15-min creds allowed only to open a Transcribe stream
  lambda/analyze       validate → last 60 s → Bedrock → level rules (rules.ts) → SNS alert
  lambda/agent         transcript → Bedrock as the family persona → guards (rules.ts) → next line + status
  scripts/             5 test scripts, a runner against the deployed Lambdas, deploy and check helpers
contracts/  Shared TypeScript types (Utterance, AnalyzeRequest, RiskState, AgentRequest, AgentResponse)
```

## AWS resources

| Component | Resource | Notes |
|---|---|---|
| Web app | Amplify Hosting app `scam-shield`, branch `main` | Manual zip deploys, no Git connection |
| Live transcription | Transcribe streaming (called from the browser) | Speaker labels on. Nothing to provision |
| Credentials Lambda | Function URL + `BrowserTranscribeRole` | Role allows only `transcribe:StartStreamTranscriptionWebSocket`. Replaces the Cognito identity pool from the doc, same effect, less setup |
| Analyze Lambda | Function URL, Node 22 arm64, 15 s timeout | Role: `bedrock:InvokeModel` on Claude models, `sns:Publish` on the family topic |
| Agent Lambda | Function URL, Node 22 arm64, 15 s timeout | Same permissions. Only this function gets the verification answer |
| Family alert | SNS topic `FamilyAlerts` with email (and optional SMS) subscription | Alert when red + elder engaging; summary when the agent finishes |

Elder settings (name, verification question and answer, agent persona, family email, model) are CDK context in `backend/cdk.json`, passed to the Lambdas as environment variables. The values in the repo are demo data.

## Setup

1. AWS credentials for the team account (`~/.aws/credentials` or env vars). Check with `npx tsx scripts/whoami.ts` in `backend/`.
2. Bedrock access to **Claude Haiku 4.5**. Check with `npx tsx scripts/check-bedrock.ts`.
3. Set `familyEmail` in `backend/cdk.json`. After deploying, click the confirmation link SNS emails you. (US SMS needs a registered sending number, which takes up to 15 business days, so email is the channel for now.)
4. `npm install`
5. `cd backend && npx cdk bootstrap` (once per account/region)

## Deploy and run

```
cd backend
npm run deploy              # cdk deploy, writes cdk-outputs.json and frontend/.env.local
npm run scripts:run         # plays the test scripts against the real Lambdas (sends real alert emails)
cd ../frontend
npm run dev                 # local; open on the laptop
npm run build && npm run deploy:web -w backend   # push to Amplify, URL printed
```

The mic needs HTTPS (or localhost). On an iPhone use the Amplify URL, then Share → Add to Home Screen.
Demo mode plays a test script through the whole flow, including the agent speaking and scripted caller replies, without a mic.

`npm test` runs the rule unit tests (no AWS needed).

## Known Stage 1 shortcuts

- All function URLs are public (`authType: NONE`) with CORS `*`. Anyone with a URL can trigger Bedrock calls and family emails. Lock CORS to the Amplify domain; Cognito comes in Stage 3.
- One elder, hardcoded. `elderId` is always `e-01`.
- The app can't see the caller's number, so "only unknown numbers" relies on the elder starting it. Stage 2 (Connect) checks caller ID against `trustedContacts`.
- The agent speaks through the laptop speaker into the speakerphone, so the caller hears it at speakerphone quality. The mic is muted (silence sent) while it speaks.
