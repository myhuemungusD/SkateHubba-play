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

| Command                 | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `npm run dev`           | Start Vite dev server at `localhost:5173` with HMR |
| `npm run build`         | TypeScript check + production build → `dist/`     |
| `npm run preview`       | Serve the production build locally                 |
| `npm test`              | Run the Vitest suite once (CI mode)                |
| `npm run test:watch`    | Run tests in watch mode while editing              |
| `npm run test:coverage` | Run tests with V8 coverage + threshold enforcement |
| `npm run test:rules`    | Firestore rules unit tests (starts emulator)       |
| `npm run test:e2e`      | Playwright E2E tests (starts emulator)             |
| `npm run lint`          | ESLint 9 (flat config) over `src/`                 |
| `npm run format`        | Prettier 3.8 over `src/**/*.{ts,tsx}`              |
| `npm run emulators`     | Start Firebase emulators (auth/firestore/storage)  |
| `npm run cap:sync`      | `npx cap sync` — copy web build into native shells |
| `npm run cap:open:ios`  | Open the iOS project in Xcode                      |
| `npm run cap:open:android` | Open the Android project in Android Studio     |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your Firebase project values.

### Required

Get these from Firebase Console → Project Settings → General → Your Apps → Web App:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Optional

```
VITE_USE_EMULATORS=true    # Connect to local Firebase emulators (see below)
VITE_APP_URL=https://...   # Used in Firebase email action links (password reset,
                           # verification). Falls back to window.location.origin.
```

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
│   ├── App.tsx              # Router (`react-router-dom`) + auth guard + NavigationContext
│   ├── firebase.ts          # Firebase initialization
│   ├── main.tsx             # React entry point + Sentry init
│   ├── index.css            # Tailwind v4 @theme + custom animations
│   ├── hooks/               # useAuth, useOnlineStatus, usePlayerProfile, etc.
│   ├── services/
│   │   ├── auth.ts          # Sign-up, sign-in, Google OAuth, password reset
│   │   ├── users.ts         # Profiles + atomic username reservation
│   │   ├── games.ts         # Game CRUD + real-time subscriptions
│   │   ├── storage.ts       # Video upload (WebM on web, MP4 on native)
│   │   ├── analytics.ts     # Vercel Analytics event tracking
│   │   └── notifications.ts # In-app notification writes
│   ├── context/             # AuthContext, GameContext, NavigationContext, NotificationContext
│   └── __tests__/           # setup.ts, smoke-helpers.tsx, split smoke-*.test.tsx files
├── functions/               # Cloud Functions (push, billing, scheduled turn forfeit)
├── e2e/                     # Playwright E2E tests (run against emulators)
├── rules-tests/             # Firestore rules unit tests
├── ios/ + android/          # Capacitor native projects
├── firestore.rules          # Firestore security rules
├── storage.rules            # Storage security rules (WebM + MP4)
├── vercel.json              # Vercel SPA config + security headers
├── firebase.json            # Firebase CLI config
├── vite.config.ts           # Vite + Vitest + @tailwindcss/vite
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

- `App.tsx` owns the `<Routes>` tree, the auth guard, and the `NavigationProvider`. It's intentionally large — don't split it into route-based files.
- Screen transitions go through `nav.setScreen(...)` (from `NavigationContext`). New screens should add a `<Route>` in `App.tsx` and a branch in `NavigationContext`'s screen → path mapping so legacy callsites keep working.
- If a new Firebase operation belongs in a service function, add it to the relevant service file.

### Styling

- Tailwind classes for all styling. No inline styles, no CSS modules.
- Brand tokens: `text-brand-orange` (`#FF6B00`), `text-brand-green` (`#00E676`), `text-brand-red` (`#FF3D00`)
- Background: `bg-[#0A0A0A]` for the page, `bg-surface` for cards, `bg-surface-alt` for inputs
- Typography: `font-display` (Bebas Neue, headings), `font-body` (DM Sans, body text)
- Custom animations only in `src/index.css`

---

## Deploying Security Rules

After changing `firestore.rules` or `storage.rules`, deploy manually:

```bash
firebase deploy --only firestore:rules,storage
```

Rules are not deployed by Vercel and not deployed by CI — this is intentional. See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for more detail.

---

## Adding a New Screen

1. Add the new screen name to the `Screen` union in `src/context/NavigationContext.tsx` and map it to a URL path.
2. Add a `<Route>` entry in `App.tsx` using the same path.
3. Add a navigation trigger somewhere (a button that calls `nav.setScreen("newscreen")` or `navigate("/newscreen")`).
4. Add focused smoke tests in `src/__tests__/smoke-<area>.test.tsx` — either extend an existing file or create a new one for the screen's area.

---

## Running CI Checks Locally

The same checks that run in CI, in the same order:

```bash
npm run lint            # ESLint 9 (flat config)
npx tsc -b              # TypeScript
npm run test:coverage   # Vitest + V8 coverage thresholds
npm run build           # Production build
npm run test:e2e        # Playwright E2E (requires emulators)
```

All of these must pass before a PR can merge. The CI pipeline (`.github/workflows/main.yml`) also runs Lighthouse CI after the build.
