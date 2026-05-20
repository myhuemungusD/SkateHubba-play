# Development Guide

## Prerequisites

- **Node.js 22+** — matches the CI environment (`.github/workflows/main.yml`)
- **npm** — use `npm ci` for reproducible installs; do not use yarn or pnpm
- **Firebase CLI** — required for emulator-based development

  ```bash
  npm install -g firebase-tools
  ```

---

## Initial Setup

```bash
git clone https://github.com/myhuemungusD/skatehubba-play.git
cd skatehubba-play
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your Firebase project values (see [Environment Variables](#environment-variables) below). Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Available Scripts

| Command                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run dev`           | Start Vite dev server at `localhost:5173` with HMR                          |
| `npm run build`         | TypeScript check + production build → `dist/`                               |
| `npm run preview`       | Serve the production build locally                                          |
| `npm run typecheck`     | Run `tsc -b` only                                                           |
| `npm test`              | Run the full test suite once (CI mode)                                      |
| `npm run test:watch`    | Run tests in watch mode while editing                                       |
| `npm run test:coverage` | Run tests with coverage report (CI gate enforces thresholds)                |
| `npm run test:rules`    | Run Firestore rules tests against the rules emulator                        |
| `npm run test:e2e`      | Run Playwright E2E tests (auto-starts the Auth/Firestore/Storage emulators) |
| `npm run lint`          | Lint `src/` with ESLint                                                     |
| `npm run lint:fix`      | Lint and auto-fix where possible                                            |
| `npm run format`        | Format `src/**/*.{ts,tsx}` with Prettier                                    |
| `npm run verify`        | Full CI gate: `tsc -b && lint && test:coverage && build`                    |
| `npm run emulators`     | Start the Firebase emulator suite locally                                   |

---

## Environment Variables

[`.env.example`](../.env.example) is the source of truth — copy it to `.env.local` and fill in the values you need. Each variable is documented inline with where to get it and what it controls.

Quick summary:

- **Required for any local run:** the six `VITE_FIREBASE_*` keys from Firebase Console → Project Settings → General → Your Apps → Web App.
- **Required for the `/map` page:** `VITE_MAPBOX_TOKEN`. The map silently fails to render without it.
- **Local-only:** `VITE_USE_EMULATORS=true` to point the app at the Firebase emulator suite (see below). Only takes effect in `npm run dev`.
- **Optional / production-recommended:** FCM push (`VITE_FIREBASE_VAPID_KEY`), Analytics (`VITE_FIREBASE_MEASUREMENT_ID`), App Check (`VITE_RECAPTCHA_SITE_KEY` + `VITE_APPCHECK_ENABLED`), Sentry (`VITE_SENTRY_DSN`), PostHog (`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`), `VITE_APP_URL` for Firebase email action links, and `VITE_MAPBOX_STYLE_URL` to point `/map` at a custom Mapbox Studio style (defaults to `mapbox://styles/mapbox/dark-v11`; invalid values fall back to that default with a console warning).

For Vercel preview/production setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Firebase Emulators (Recommended)

Using the Firebase emulators lets you develop without touching the production database or running up quota. All data is ephemeral and reset each time you stop the emulators.

### Start the emulators

```bash
firebase login            # First time only
firebase use <project-id> # First time only
firebase emulators:start
```

Default ports:

| Service        | Port |
| -------------- | ---- |
| Authentication | 9099 |
| Firestore      | 8080 |
| Storage        | 9199 |
| Emulator UI    | 4000 |

### Connect the app to the emulators

In `.env.local`:

```
VITE_USE_EMULATORS=true
```

Both `VITE_USE_EMULATORS=true` **and** running in Vite dev mode (`npm run dev`) must be true for the emulators to activate. The emulators cannot be enabled in a production build.

### Emulator UI

Open [http://localhost:4000](http://localhost:4000) while the emulators are running. From there you can inspect Firestore documents, Auth users, and Storage files in real time — useful for debugging game state.

---

## Project Structure

```
skatehubba-play/
├── src/
│   ├── App.tsx              # Route table + auth guard + screen state machine
│   ├── firebase.ts          # Firebase initialization
│   ├── main.tsx             # React entry point
│   ├── index.css            # Tailwind v4 @theme + custom animations
│   ├── context/             # AuthContext, GameContext, NavigationContext, NotificationContext
│   ├── hooks/               # useAuth, usePlayerProfile, useBlockedUsers, …
│   ├── services/            # Single entry point for every Firebase SDK call
│   │   ├── auth.ts          # Sign-up, sign-in, Google OAuth, password reset
│   │   ├── users.ts         # Profiles + atomic username reservation
│   │   ├── games.ts         # Game CRUD + real-time subscriptions + transactions
│   │   ├── clips.ts         # Landed-trick clips feed + upvotes
│   │   ├── spots.ts         # Skate spots (geo-tagged map)
│   │   └── storage.ts       # Video upload (WebM/MP4)
│   ├── components/          # Reusable UI (Tailwind classes only)
│   ├── screens/             # Full-page screen components
│   ├── lib/                 # Sentry, PostHog, env validation, mapbox, consent
│   └── __tests__/           # Smoke tests (one file per screen area)
│       ├── setup.ts         # Global test setup (jest-dom matchers)
│       ├── smoke-helpers.tsx
│       └── smoke-*.test.tsx # smoke-auth, smoke-lobby, smoke-gameplay, …
├── e2e/                     # Playwright E2E tests
├── rules-tests/             # Firestore rules tests (@firebase/rules-unit-testing)
├── firestore.rules          # Firestore security rules
├── storage.rules            # Storage security rules
├── vercel.json              # Vercel SPA config + noindex headers
├── firebase.json            # Firebase CLI config (named DB: skatehubba)
├── vite.config.ts           # Vite + Vitest config (Tailwind v4 plugin)
└── docs/                    # Documentation
```

---

## Coding Conventions

### TypeScript

- **Strict mode** is on (`tsconfig.app.json`). All code must pass `npx tsc -b` with zero errors.
- Avoid `any`. Use proper types or generics.
- Prefer explicit return types on exported service functions.

### Service layer

- All Firebase calls belong in `src/services/`. Components import from services, never from the Firebase SDK directly.
- Write operations that require atomicity use `runTransaction`.
- Input sanitization happens at the service boundary (see `setTrick` — trim + slice before the transaction).

### Component architecture

- `App.tsx` is the intentional monolith — it owns the full route table, auth-gated `<Route>`s, and the global provider tree (Auth/Navigation/Notification/Game). Do not split it into route-based files without discussion.
- URL routing uses `react-router-dom` v7. All `<Route>` elements live in `App.tsx`. Screen transitions go through `NavigationContext.setScreen` (or `useNavigate` for parameterised routes).
- Non-critical screens (gameplay, profile, map, settings, legal pages) are `lazy()`-imported and wrapped in `<Suspense>`; Landing/AuthScreen/ProfileSetup/Lobby are eager for first paint.
- New Firebase operations belong in the relevant `src/services/*.ts` file — components never import the Firebase SDK directly.

### Styling

- Tailwind classes for all styling. No inline styles, no CSS modules.
- Brand tokens: `text-brand-orange` (`#FF6B00`), `text-brand-green` (`#00E676`), `text-brand-red` (`#FF3D00`)
- Background: `bg-background` for the page, `bg-surface` for cards, `bg-surface-alt` for inputs
- Typography: `font-display` (Bebas Neue, headings), `font-body` (DM Sans, body text)
- Custom animations and the Tailwind v4 `@theme` block live in `src/index.css`

---

## Deploying Security Rules

After changing `firestore.rules` or `storage.rules`, deploy manually:

```bash
firebase deploy --only firestore:rules,storage
```

Rules are not deployed by Vercel and not deployed by CI — this is intentional. See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for more detail.

---

## Adding a New Screen

1. Add a `<Route>` in `App.tsx`. If the screen is below the first-paint fold, wrap the import in `lazy()` and rely on the existing `<Suspense>` boundary.
2. Add the navigation trigger — usually `nav.setScreen("…")` from `NavigationContext`, or `useNavigate` for parameterised routes.
3. Add an auth guard if the screen requires a signed-in user or a profile (mirror the existing `auth.activeProfile ? <Screen/> : <Navigate to="/" replace/>` pattern).
4. Add smoke tests in the relevant `src/__tests__/smoke-*.test.tsx` (or create `smoke-<area>.test.tsx`).

---

## Running CI Checks Locally

Mirror the full CI gate in one command:

```bash
npm run verify    # tsc -b && lint && test:coverage && build
```

Or step through individually:

```bash
npx tsc -b              # Type check
npm run lint            # ESLint
npm run test:coverage   # Tests with 100% services/hooks threshold
npm run build           # Production build
```

All four must pass before a PR can merge.
