# Frontend (ScamDetermine PWA)

React 19 + Vite + TypeScript + React Router. Deployed on Vercel. Built from the Figma file
"sunhacks", page **03 Screens**.

```
npm install          # from the repo root (npm workspaces)
npm run dev          # http://localhost:5173
```

| URL | What |
|---|---|
| `/` | The demo flow: onboarding → idle → live call → summary |
| `/schematic` | The Figma canvas: every screen, live, in scaled frames. Reference while you build |
| `/dashboard/live` | Desktop dashboard. Open it in a second tab or window: it mirrors the call running in the elder tab |

With no `.env.local`, the app runs in **mock mode**: calls are scored in the browser
(keyword matching + the real level rules from `backend/lambda/analyze/rules.ts`), no AWS, no texts.
Add `?mock` to any URL to force it even when a Lambda URL is configured.

## Demo flow

```
/  →  O1 family contacts → O2 secret question → O3 mic  →  E1 idle
   →  (Start listening | demo script)  →  /elder/live: E1a → E2 / E3 / E4 / E5 by call state
   →  Hang up / End call  →  E6 summary  →  E1
```

`src/flow/routes.tsx` is the only file that knows the order. Screens are presentational: they take
data + callbacks as props and default to sample data so they render alone in the schematic.

## Components (each maps to a Figma component)

| Figma component | Code | File |
|---|---|---|
| Risk/Light (hero, badge) | `RiskLight` | `components/Risk.tsx` |
| Risk/StatusPanel | `StatusPanel` (copy in `PANEL_COPY`) | `components/Risk.tsx` |
| Button | `BigButton` (`hangup`, `primary`, `secondary`) | `components/Risk.tsx` |
| Call/Header | `CallHeader` | `components/Risk.tsx` |
| Polly speaking pill (E4) | `SpeakingPill` | `components/Risk.tsx` |
| field (onboarding) | `Field` | `components/Risk.tsx` |
| SMS/Bubble | `SmsBubble` | `components/Risk.tsx` |
| Transcript/Line, Transcript/TacticChip | `TranscriptLine`, `Transcript`, `TacticChip` | `components/Dashboard.tsx` |
| Stage/Tracker | `StageTracker` | `components/Dashboard.tsx` |
| VerifyCard | `VerifyCard` | `components/Dashboard.tsx` |
| D3 adjudication card | `VerdictCard` | `components/Dashboard.tsx` |
| Evidence/Chart | `EvidenceChart` | `components/Dashboard.tsx` |
| D4 metric tile, top bar | `MetricTile`, `DashboardTopBar` | `components/Dashboard.tsx` |

Styles: `components/components.css` (one section per component), screen layouts in
`styles/global.css`, colours in `styles/tokens.css` (from the Figma variables; dark theme =
`data-theme="dark"`, used by the E5 dark preview).

## Screens

| Figma frame | File | Data |
|---|---|---|
| E1 Idle protected | `screens/elder/E1Idle.tsx` | settings, `onStart` |
| E1a / E2 / E3 / E4 / E5 call states | `screens/elder/E*.tsx` (shared `CallLayout.tsx`) | `risk`, `elapsed`, `onEnd`, `onAnswer` (E4) |
| E6 Call ended summary | `screens/elder/E6Summary.tsx` | last `risk` |
| O1–O3 onboarding | `screens/onboarding/*` | `onNext` / `onAllow`, saved to localStorage |
| F1 SMS alert, F2 Call summary | `screens/family/*` | sample data (no call storage yet) |
| D1 Live call | `screens/dashboard/D1LiveCall.tsx` | live call, mirrored across tabs |
| D2 / D3 | `screens/dashboard/D2*.tsx`, `D3*.tsx` (shared `LiveDashboard.tsx`) | fixtures |
| D4 Metrics, D5 Load test | `screens/dashboard/D4*.tsx`, `D5*.tsx` | props / sample pattern |

`src/routes.ts` lists every screen (id, Figma name, path); put your name in `owner` to claim one.

## How design concepts map to the backend

The Figma dashboard uses an evidence score with LLRs and four scam stages. The Stage 1 backend
returns `risk` (0–100) and nine `tactics`. The app bridges them (`lib/stages.ts`):

- Stages: impersonation → Claim; urgency, threats → Pressure; secrecy → Isolation; money / gift
  cards / wire / remote access / personal info → Extraction.
- Per-line "LLR" column shows `Δ` = how much that line moved `risk`.
- Evidence chart plots `risk` per analyze call against the real thresholds (red ≥ 60, green < 40).
- "Checking" (E4, blue) is yellow + `action: ask_verification`; the elder asks the question and taps
  Yes / No (there is no backend text-to-speech).

## Live backend

After `cd backend && npm run deploy`, `frontend/.env.local` gets `VITE_REGION`,
`VITE_CREDENTIALS_URL`, `VITE_ANALYZE_URL`. A live red result **texts the family**.

## Vercel

`vercel.json` at the repo root handles the build. Import the repo in Vercel with the
**Root Directory left as the repo root**. Add the three `VITE_*` env vars in project settings to
use the real backend; leave them out for a mock-mode deploy.
