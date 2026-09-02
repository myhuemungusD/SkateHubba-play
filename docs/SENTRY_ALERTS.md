# Sentry Error Monitoring & Alert Routing

## Overview

SkateHubba uses [@sentry/react](https://docs.sentry.io/platforms/javascript/guides/react/) for runtime error monitoring on the web. On native (Capacitor) builds, `src/lib/sentry.ts` initialises [@sentry/capacitor](https://docs.sentry.io/platforms/javascript/guides/capacitor/) — which wraps `@sentry/react` — so Swift/Obj-C/Kotlin/Java crashes are forwarded too. Both are direct dependencies. The SDK is lazily loaded — it is only fetched when `VITE_SENTRY_DSN` is set.

## Environment Variable

| Variable          | Where to set                                      | Example                                    |
| ----------------- | ------------------------------------------------- | ------------------------------------------ |
| `VITE_SENTRY_DSN` | Vercel → Project Settings → Environment Variables | `https://abc123@o456.ingest.sentry.io/789` |

Set this for **Production** and **Preview** environments. Leave unset in local dev unless you need to test Sentry integration.

## Error Boundary Coverage

Errors are captured at multiple levels:

| Layer                    | File                                           | What it catches                                                    |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| **Top-level boundary**   | `src/App.tsx` → `<ErrorBoundary>`              | Any unhandled React render error across the entire app             |
| **GamePlay boundary**    | `src/App.tsx` → screen-level `<ErrorBoundary>` | Crashes during active gameplay (video recording, trick submission) |
| **GameOver boundary**    | `src/App.tsx` → screen-level `<ErrorBoundary>` | Crashes during game-over / rematch flow                            |
| **Unhandled rejections** | `src/main.tsx` → `window.addEventListener`     | Async errors that escape try/catch blocks                          |

All boundaries report to Sentry via `captureException()` with component stack traces.

### User Context

When a user signs in, a deterministic **hash** of their Firebase UID (`hashIdentity` / `hashUid`, FNV-1a, `src/utils/pii.ts`) is attached as the Sentry user id — the raw UID never leaves the app. Their public **username** is attached alongside it when available (`src/context/AuthContext.tsx`). This is cleared on sign-out. Email is never sent, and `beforeSend` deletes `user.email` and `user.ip_address` defensively. Treat the username as an identifier when scoping who can read Sentry.

## Configuring Sentry Alerts

### 1. Create a Sentry Project

1. Go to [sentry.io](https://sentry.io) → Create Project → **React**
2. Copy the DSN and set `VITE_SENTRY_DSN` in Vercel

### 2. Set Up Alert Rules

In Sentry → **Alerts** → **Create Alert Rule**:

#### Critical Alert (immediate — for beta launch)

- **When:** A new issue is created
- **Filter:** `event.environment:production`
- **Then:** Send notification to **Email** (team) + **Slack** channel
- **Action interval:** Every occurrence (for beta; adjust post-launch)

#### High-Volume Alert

- **When:** Number of events in an issue exceeds **50 in 1 hour**
- **Filter:** `event.environment:production`
- **Then:** Send notification to **Slack** `#skatehubba-alerts`
- **Priority:** Critical

#### Regression Alert

- **When:** A resolved issue re-occurs
- **Filter:** `event.environment:production`
- **Then:** Send notification to **Email** + **Slack**

#### Map Outage Alert (`map_token_missing`)

Fires on the first page view where `VITE_MAPBOX_TOKEN` is unset in production — the deploy is serving the "Map is temporarily unavailable" fallback. Emitted as a warning-level Sentry message from `src/components/map/SpotMap.tsx`.

- **When:** A new issue is created
- **Filter:** `event.environment:production AND message:"map_token_missing"`
- **Then:** Send notification to **Slack** `#skatehubba-alerts`
- **Action interval:** Once per issue (not every occurrence — the event fires on every page view when the token is missing, so high volume is expected)
- **Remediation:** Add `VITE_MAPBOX_TOKEN` in Vercel → Project Settings → Environment Variables and redeploy (env var changes do not auto-rebuild). See `docs/DEPLOYMENT.md#map-is-temporarily-unavailable-on-map`.

#### Map Style Misconfig (`map_style_invalid`)

Fires once per page view of `/map` when `VITE_MAPBOX_STYLE_URL` is set to a value that is neither a `mapbox://styles/` URI nor an https URL. The map still renders against the default `mapbox://styles/mapbox/dark-v11` fallback, so this is a soft alert — not a user-facing outage. Emitted from `src/lib/mapbox.ts` with the offending value attached as `extra.styleUrl`.

- **When:** A new issue is created
- **Filter:** `event.environment:production AND message:"map_style_invalid"`
- **Then:** Send notification to **Slack** `#skatehubba-alerts`
- **Action interval:** Once per issue (the event fires on every /map page view while the misconfig is live)
- **Remediation:** Open the Sentry event, copy `extra.styleUrl`, and check Vercel → Project Settings → Environment Variables. Either correct the value (must start with `mapbox://styles/` or be a valid `https://` URL) and redeploy, or unset the var to use the default. If self-hosting on a non-Mapbox domain, also extend the `connect-src` directive in `vercel.json` to whitelist that origin.

### 3. Slack Integration

1. Sentry → **Settings** → **Integrations** → **Slack**
2. Authorize the workspace
3. In each alert rule, choose **Send a Slack notification** → pick the channel (e.g., `#skatehubba-alerts`)

### 4. Email Routing

By default, Sentry sends email alerts to all project members. To customize:

1. Sentry → **Settings** → **Notifications**
2. Set per-project email preferences
3. Consider creating a team email alias (e.g., `skatehubba-team@yourorg.com`) for on-call routing

## Sampling Rates

| Environment | Traces Sample Rate | Rationale                                       |
| ----------- | ------------------ | ----------------------------------------------- |
| Development | 100%               | Full visibility during local testing            |
| Production  | 10%                | Stay within free tier quota; increase if needed |

Adjust `tracesSampleRate` in `src/main.tsx` as traffic grows.

## PII Scrubbing

The `beforeSend` hook in `src/main.tsx` does considerably more than strip `email=`:

- Scrubs `email`, `token`, `api_key`, `access_token`, `id_token`, `auth`, `authorization`, `password`, `phone`, `otp`, and `verification_code` from event URLs.
- Deletes `event.request.headers` and `event.request.cookies` wholesale.
- Deletes `event.user.email` and `event.user.ip_address`.
- Scrubs breadcrumb `data.url` values.
- `sendDefaultPii: false` is set at init.

Separately, `src/services/logger.ts` redacts `email` and `*uid` keys on the breadcrumb path (`src/utils/pii.ts`). User context is a **hashed** UID plus the public username — never the raw UID, never an email address.

## Verifying the Setup

1. Deploy with `VITE_SENTRY_DSN` set
2. Open the browser console and run: `throw new Error("Sentry test")`
3. Confirm the event appears in Sentry → **Issues** within ~30 seconds
4. Confirm alert notifications arrive in Slack/email

---

## Known caveats and gaps

**`environment:production` also matches preview deploys.** `src/main.tsx` sets
`environment: import.meta.env.MODE`, and `vite build` yields `MODE === "production"`
for _every_ build — including the Vercel preview deployments this doc tells you to
give a `VITE_SENTRY_DSN`. The `event.environment:production` filter on the alert
rules above therefore cannot distinguish production from preview. Either accept the
noise or derive the environment from a Vercel-provided variable; `VERCEL` is already
parsed in `src/lib/env.ts` and currently unused for this.

**Releases and source maps.** `.github/workflows/release.yml` runs
`getsentry/action-release` to create the Sentry release and upload the hidden source
maps from `./dist/assets`, gated on the `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and
`SENTRY_PROJECT` secrets. The release string comes from `VITE_APP_VERSION` /
`VITE_GIT_SHA` (`src/main.tsx`). Without those secrets, production stack traces stay
minified — this is what makes them readable, so treat the secrets as part of the
alerting setup, not an afterthought.

**App Check failures have no alert rule yet.** `docs/APPCHECK_ROLLOUT.md` names
`appcheck_init_failed`, `appcheck_enabled_but_no_site_key`,
`appcheck_native_init_failed`, and `users/{uid} permission-denied after retries` as
rollout abort triggers, but this document defines no matching alert — it currently
covers only the two map alerts. Add them before the next App Check enablement attempt.
