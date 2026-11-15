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
| E7 Family takeover (not in Figma yet) | `screens/elder/E7Takeover.tsx` | `agentStatus`, `speaking`, `onTakeBack` |
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

## Mobile PWA

Install: open the Vercel URL on the phone. **iPhone:** Safari → Share → Add to Home Screen (E1 shows
these steps). **Android:** Chrome shows an Install button on E1. The mic needs HTTPS, so use the Vercel
URL, not a LAN IP.

| What | Where |
|---|---|
| Manifest, icons (192 / 512 / maskable / 180 apple-touch) | `public/manifest.webmanifest`, `public/icons/` (regenerate: `npm run icons -w frontend`, source `scripts/gen-icons.ts`) |
| Service worker: offline shell, cached assets + fonts; never caches Lambda calls | `src/sw.ts`, built to `dist/sw.js` as its own Vite entry (production builds only; bump `VERSION` to force a refresh) |
| Screen stays on during a call (a locked screen stops the mic) | `useWakeLock` in `lib/pwa.ts` |
| Sound on yellow / checking / red, vibration on Android (iOS has no vibration API) | `lib/alerts.ts`; audio is unlocked by the tap that starts the call |
| Status bar turns red on a scam | `useThemeColor` in `lib/pwa.ts` (Android Chrome; iOS mostly ignores it when installed) |
| Warning if the app was backgrounded mid-call (iOS pauses the mic) | `useBackgroundedDuring` in `flow/routes.tsx` |
| Install card | `components/InstallHint.tsx`, on E1 |
| Short-phone layout (call screens fit 667px without scrolling), no zoom / bounce, safe areas | `styles/global.css` |
| Dev panel hidden when launched from the Home Screen | `@media (display-mode: standalone)` in `styles/global.css` |

Limits: the phone running the app can't be the phone on the call (the call takes the mic). Run the
app on a second device next to the speakerphone, foreground, screen on.

## Hang-up and speakerphone detection

The app sits next to the speakerphone, so it can't read the phone's call state; it infers it and
asks the elder to confirm with one tap.

| Signal | Event (POST `/events`) | Elder sees |
|---|---|---|
| Caller audio stops for 12 s | `speaker_off` (audio) | "We can't hear the caller": Yes, on speaker / I hung up |
| Caller audio comes back, or elder confirms | `speaker_on` | sheet closes |
| Dial / busy tone (350+440 / 480+620 Hz) | `hangup` after 8 s unless denied | "Did the call end? Ending in 8 s" |
| 30 s of silence | `hangup` after 15 s unless denied | same |
| Caller says "take me off speaker", "are you alone?" | `off_speaker_requested` (transcript) | "Keep them on speaker" |
| Hang up / End call / "Yes, it ended" | `hangup` (elder) | summary |

The Events Lambda texts the family when a yellow/red call goes off speaker (we can't hear it any
more) and after a hang-up on a red call. Code: `lib/presence.ts`
(detector, unit tested with synthetic audio), `lib/useCallEvents.ts`, `components/CallEvents.tsx`,
`backend/lambda/events/`. In demo mode there's no mic: use the **Sim:** buttons in the dev panel.

## Live backend

After `cd backend && npm run deploy`, `frontend/.env.local` gets `VITE_REGION`,
`VITE_CREDENTIALS_URL`, `VITE_ANALYZE_URL`, `VITE_AGENT_URL`, `VITE_EVENTS_URL`. A live call **emails the family** once the
elder starts going along with a red call, and the Events Lambda alerts them on off-speaker / hang-up events during risky calls.
Without `VITE_EVENTS_URL` events stay in the browser.

## Agent takeover

When the call is red and the elder is clearly complying, the Analyze Lambda returns
`action: agent_takeover`. `useCall` then loops: Agent Lambda → speak the line with the browser's
built-in voice (`lib/speech.ts`, mic muted meanwhile) → wait for the caller's reply → Agent Lambda.
The live route shows E7 until the agent hands the call back (`verified`), ends it
(`scam_confirmed` / `caller_left`), or the elder taps **Let me talk**. Demo scripts include scripted
caller replies to the agent. Without `VITE_AGENT_URL` (or with `?mock`) the agent is `lib/mockAgent.ts`.

## Vercel

`vercel.json` at the repo root handles the build. Import the repo in Vercel with the
**Root Directory left as the repo root**. Add the five `VITE_*` env vars in project settings to
use the real backend; leave them out for a mock-mode deploy.
