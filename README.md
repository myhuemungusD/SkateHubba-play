<div align="center">

<!-- GitHub dark mode: show white logo; light mode: show black logo -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/logo-white.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/logo-black.png">
  <img src="docs/screenshots/logo-black.png" alt="SkateHubba" width="200">
</picture>

### Own the spot. Play S.K.A.T.E. anywhere.

An async multiplayer trick battle game for skateboarders.
Challenge friends, set tricks on video, and see if they can match you — one letter at a time.

[![Play Now](https://img.shields.io/badge/Play_Now-skatehubba.com-FF6B00?style=for-the-badge&logo=vercel&logoColor=white)](https://skatehubba.com)
[![CI](https://img.shields.io/github/actions/workflow/status/myhuemungusD/SkateHubba-play/main.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/myhuemungusD/SkateHubba-play/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)](CONTRIBUTING.md)

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Firebase](https://img.shields.io/badge/Firebase-12-DD2C00?style=flat-square&logo=firebase&logoColor=white)](https://firebase.google.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![GitHub Release](https://img.shields.io/github/v/release/myhuemungusD/SkateHubba-play?style=flat-square&label=release&color=FF6B00)](https://github.com/myhuemungusD/SkateHubba-play/releases)

<br>

<img src="docs/screenshots/graffiti-banner.webp" alt="SkateHubba graffiti branding — stacked skateboards against a tagged wall" width="600">

</div>

<br>

## What is S.K.A.T.E.?

S.K.A.T.E. is the skateboarding version of HORSE. One player sets a trick; the other must land it. Miss and you earn a letter — **S**, then **K**, then **A**, then **T**, then **E**. First to spell it out loses.

This app brings that to your phone, async. Set your trick whenever, opponent matches whenever. No need to be at the same spot or online at the same time.

---

## Screenshots

<div align="center">
<table>
<tr>
<td align="center"><strong>Landing Page</strong></td>
<td align="center"><strong>Your Games</strong></td>
<td align="center"><strong>Forfeit Screen</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/landing.webp" alt="SkateHubba landing page — hero with 'Own The Spot' tagline" width="320"></td>
<td><img src="docs/screenshots/home-screen.webp" alt="Your Games dashboard showing active and completed matches" width="320"></td>
<td><img src="docs/screenshots/forfeit-screen.webp" alt="Forfeit screen with skull icon and rematch button" width="320"></td>
</tr>
</table>
</div>

---

## Tech Stack

| Layer     | Technology                                                   |
| --------- | ------------------------------------------------------------ |
| Frontend  | React 19, TypeScript 5.6, Vite 8 (Rolldown)                  |
| Styling   | Tailwind CSS 4 (dark theme, custom brand tokens)             |
| Auth      | Firebase Authentication (email/password + Google OAuth)      |
| Database  | Cloud Firestore (real-time, offline-capable)                 |
| Storage   | Firebase Storage (trick videos — WebM on web, MP4 on native) |
| Native    | Capacitor (iOS + Android)                                    |
| Hosting   | Vercel                                                       |
| Analytics | Vercel Analytics (cookie-free, GDPR-safe)                    |
| Errors    | Sentry                                                       |
| Testing   | Vitest, @testing-library/react, Playwright (E2E)             |
| CI        | GitHub Actions                                               |

No custom backend. No serverless functions. The client talks directly to Firebase with security enforced by Firestore rules.

---

## Features

- **Async gameplay** — players take turns on their own schedule
- **Video tricks** — record one-take videos in-browser (WebM) or native app (MP4)
- **Real-time updates** — both players see game state the moment it changes
- **24-hour turn timer** — games don't stall; expired turns auto-forfeit
- **Google OAuth** — popup sign-in with redirect fallback for mobile/Safari
- **Email verification** — required before play; resend from the app
- **Atomic username reservation** — no two players share a handle (Firestore transaction)
- **Invite & share** — SMS, link copy, native share for invites and trick clips
- **Offline support** — Firestore local cache lets you read games without internet
- **Native apps** — Capacitor builds for iOS and Android
- **PWA-ready** — installable from the browser
- **Security rules** — all game logic validated server-side; client can't cheat scores
- **Cookie-free analytics** — Vercel Analytics with full funnel instrumentation

---

## Quick Start

```bash
git clone https://github.com/myhuemungusD/SkateHubba-play.git
cd SkateHubba-play
npm install
cp .env.example .env.local
# Fill in your Firebase config values in .env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

For full setup including Firebase emulators, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Scripts

| Command                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Start dev server at localhost:5173            |
| `npm run build`         | Type-check + production build → dist/         |
| `npm run preview`       | Preview the production build locally          |
| `npm test`              | Run test suite once                           |
| `npm run test:watch`    | Run tests in watch mode                       |
| `npm run test:coverage` | Run tests with coverage report                |
| `npm run test:e2e`      | Run Playwright E2E tests (requires emulators) |
| `npm run lint`          | Lint source files with ESLint                 |
| `npm run emulators`     | Start Firebase emulators locally              |

---

## Project Structure

```
skatehubba-play/
├── public/                  # Static assets served at /
├── src/
│   ├── App.tsx              # react-router-dom <Routes> + auth guard + NavigationContext
│   ├── firebase.ts          # Firebase init (named DB "skatehubba")
│   ├── main.tsx             # React entry + Sentry init
│   ├── index.css            # Tailwind v4 @theme + custom animations
│   ├── components/          # Reusable UI (VideoRecorder, Leaderboard, etc.)
│   ├── screens/             # Full-page components (Lobby, GamePlay, etc.)
│   ├── context/             # AuthContext, GameContext, NavigationContext
│   ├── hooks/               # useAuth, useOnlineStatus, usePlayerProfile
│   ├── services/
│   │   ├── auth.ts          # Sign up, sign in, Google OAuth, password reset
│   │   ├── users.ts         # Profiles + atomic username reservation
│   │   ├── games.ts         # Game CRUD + real-time subscriptions
│   │   ├── storage.ts       # Video upload (WebM/MP4, 1KB–50MB, retry)
│   │   ├── analytics.ts     # Vercel Analytics event tracking
│   │   └── notifications.ts # Push notification registration
│   └── __tests__/           # Smoke tests + E2E
├── e2e/                     # Playwright E2E tests
├── docs/                    # Documentation suite
│   └── screenshots/         # README images + brand assets
├── firestore.rules          # Firestore security rules (turn order, scores, timer)
├── storage.rules            # Storage security rules (auth, size, content-type)
├── .env.example             # Environment variable template
└── vercel.json              # CSP headers, HSTS, SPA rewrites, domain redirects
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values from your Firebase project:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=   # optional — Analytics
VITE_USE_EMULATORS=true         # optional — local emulators
VITE_APP_URL=https://...        # optional — email action redirects
```

---

## Documentation

| Document                                                 | Description                                 |
| -------------------------------------------------------- | ------------------------------------------- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)               | Local setup, emulators, dev workflow        |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                 | Production deploy to Vercel + Firebase      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             | System design, data flow, decisions         |
| [docs/DATABASE.md](docs/DATABASE.md)                     | Firestore schema and security rules         |
| [docs/API.md](docs/API.md)                               | Service layer function reference            |
| [docs/TESTING.md](docs/TESTING.md)                       | Test suite overview and how to run          |
| [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md)         | Game rules and turn flow                    |
| [docs/GAME_STATE_MACHINE.md](docs/GAME_STATE_MACHINE.md) | State transitions and lifecycle             |
| [docs/DECISIONS.md](docs/DECISIONS.md)                   | Architecture decision records               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                       | How to contribute                           |
| [SECURITY.md](SECURITY.md)                               | Security policy and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md)                             | Version history                             |

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide. Short version:

1. Create a Firebase project with Auth, Firestore, and Storage enabled
2. Deploy the app to Vercel — import the repo, add env vars, deploy
3. Deploy security rules: `firebase deploy --only firestore:rules,storage`

---

## Live Demo

**[skatehubba.com](https://skatehubba.com)** — create an account and start a game in under 30 seconds.

---

## Traction

| Metric                | Status                                           |
| --------------------- | ------------------------------------------------ |
| Live at               | [skatehubba.com](https://skatehubba.com)         |
| Auth methods          | Email/password + Google OAuth                    |
| Real-time multiplayer | Firestore `onSnapshot` — sub-second updates      |
| Video infrastructure  | WebM (web) + MP4 (native), 1KB–50MB per clip     |
| Native apps           | Capacitor builds for iOS + Android               |
| CI pipeline           | Lint → type-check → test:coverage → build → Lighthouse → E2E |
| Test coverage         | 100% on services + hooks (enforced by CI)        |
| Security posture      | 0 npm vulnerabilities, Firestore rules validated |
| Bundle size (gzip)    | ~289 kB total (Firebase 148 kB, app 71 kB)       |

---

## Event Instrumentation & Core Funnel

All analytics flow through a single wrapper (`src/services/analytics.ts`) backed by [Vercel Analytics](https://vercel.com/docs/analytics) — cookie-free, GDPR-safe, zero-config. Swapping providers is a one-file change.

### Instrumented Events

| Event             | Fires When                            | Properties                    |
| ----------------- | ------------------------------------- | ----------------------------- |
| `sign_up`         | New account created                   | `method` (email / google)     |
| `sign_in`         | User logs in                          | `method` (email / google)     |
| `game_created`    | Player creates a new challenge        | `gameId`                      |
| `trick_set`       | Setter records and submits a trick    | `gameId`, `trickName`         |
| `match_submitted` | Matcher submits their attempt         | `gameId`, `landed` (bool)     |
| `game_completed`  | Game reaches a final state (win/loss) | `gameId`, `won` (bool)        |
| `video_uploaded`  | Trick video successfully uploaded     | `durationMs`, `sizeBytes`     |
| `invite_sent`     | Player shares an invite link          | `method` (sms / copy / share) |
| `clip_shared`     | Player shares a trick clip            | `method`, `context`           |
| `clip_saved`      | Player saves a trick clip locally     | `context`                     |
| `game_shared`     | Player shares a completed game        | `context`, `method`           |

### Core Funnel

```
sign_up → game_created → trick_set → match_submitted → game_completed
                                          ↓
                                   invite_sent (viral loop)
                                          ↓
                                   clip_shared (content flywheel)
```

Each step maps 1:1 to a tracked event. Drop-off between any two stages is visible in the Vercel Analytics dashboard.

---

## Roadmap: Async Gameplay → Network Effects

### Phase 1 — Core Loop (shipped)

- Async S.K.A.T.E. gameplay with video proof
- Google OAuth + email auth with verification
- Real-time game state via Firestore snapshots
- 24-hour turn timer with auto-forfeit
- Player profiles with game history

### Phase 2 — Viral Mechanics (in progress)

- **Invite flow** — SMS/link/native share to pull friends in (instrumented: `invite_sent`)
- **Clip sharing** — share trick clips to social platforms (instrumented: `clip_shared`)
- **Rematch** — one-tap rematch at game over to keep engagement loops tight
- **Push notifications** — "Your turn" alerts to reduce churn between turns

### Phase 3 — Social Graph & Discovery

- **Leaderboard** — ranked players by win rate, creating aspirational targets
- **Player profiles** — public game archives that double as social proof
- **Challenge anyone** — search/invite by username, expanding beyond existing friend groups
- **Spectator mode** — watch active games, turning players into content creators

### Phase 4 — Network Effects Flywheel

- **Crew challenges** — team-based S.K.A.T.E. (3v3) multiplies each invite by 6 players
- **Spot tagging** — geo-tagged trick locations create a skater map (UGC moat)
- **Trick library** — community trick index with video proof, building a defensible content layer
- **Tournaments** — bracket-style competitions that drive appointment engagement and shareability

**The thesis:** Each game produces shareable video content. Each shared clip is a free acquisition channel. Each new player brings their crew. The game mechanic (asynchronous, video-first) removes the coordination cost that kills most multiplayer apps — you don't need to be online at the same time or at the same spot.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/logo-white.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/logo-black.png">
  <img src="docs/screenshots/logo-black.png" alt="SkateHubba" width="80">
</picture>

**Built for skaters, by skaters.**

[skatehubba.com](https://skatehubba.com)

[MIT License](LICENSE)

</div>
