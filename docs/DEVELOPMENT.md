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

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Start Vite dev server at `localhost:5173` with HMR |
| `npm run build`      | TypeScript check + production build → `dist/`      |
| `npm run preview`    | Serve the production build locally                 |
| `npm test`           | Run the full test suite once (CI mode)             |
| `npm run test:watch` | Run tests in watch mode while editing              |

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
│   ├── App.tsx              # All screens + state machine
│   ├── firebase.ts          # Firebase initialization
│   ├── main.tsx             # React entry point
│   ├── index.css            # Tailwind directives + custom animations
│   ├── hooks/
│   │   └── useAuth.ts       # Auth state + Firestore profile hook
│   ├── services/
│   │   ├── auth.ts          # Sign-up, sign-in, Google OAuth, password reset
│   │   ├── users.ts         # Profiles + atomic username reservation
│   │   ├── games.ts         # Game CRUD + real-time subscriptions
│   │   └── storage.ts       # Video upload to Firebase Storage
│   └── __tests__/
│       ├── setup.ts         # Global test setup (jest-dom matchers)
│       └── smoke-e2e.test.tsx  # 45+ end-to-end smoke tests
├── firestore.rules          # Firestore security rules
├── storage.rules            # Storage security rules
├── vercel.json              # Vercel SPA config + noindex headers
├── firebase.json            # Firebase CLI config
├── vite.config.ts           # Vite + Vitest config
├── tailwind.config.js       # Brand tokens + font config
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

- `App.tsx` is the intentional monolith. Do not split it into route-based files.
- Screen state is a string managed with `useState`. New screens follow the existing `if/else if` pattern.
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

1. Add the new screen name to the `screen` state type in `App.tsx`.
2. Add a navigation trigger (a button or condition that sets `screen` to the new value).
3. Add the conditional render block in `App.tsx`, following the existing pattern.
4. Add smoke tests in `src/__tests__/smoke-e2e.test.tsx`.

---

## Running CI Checks Locally

The same three checks that run in CI:

```bash
npx tsc -b      # Type check
npm test        # Tests
npm run build   # Production build
```

All three must pass before a PR can merge.
