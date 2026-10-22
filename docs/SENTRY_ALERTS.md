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

#### Orphaned under-13 profile (`account_delete_underage_raced_cascade_failed`)

Fires when the COPPA erasure (`POST /api/account/delete?reason=underage`, `api/account/_underage.ts`) deleted the Auth user, then found a profile written in the race window and failed to erase it. The client can't retry, because its token no longer verifies, so the profile stays until someone erases it. Rare: the client shows the blocked card and no profile form. The event carries only `uidHash`.

- **When:** A new issue is created
- **Filter:** `event.environment:production AND message:"account_delete_underage_raced_cascade_failed"`
- **Then:** Send notification to **Slack** `#skatehubba-alerts`
- **Action interval:** Every occurrence (each one is an orphaned profile)
- **Remediation:** With the Admin SDK on the named database (`getFirestore(app, "skatehubba")`), find `users` docs whose Auth user no longer exists (`auth.getUser(uid)` rejects with `auth/user-not-found`), and pick the one where `hashUid(uid)` (`src/utils/pii.ts`) equals the event's `uidHash`. Erase it with `deleteUserDataAsAdmin` from `api/account/_deleteUserData.ts`, the same cascade the endpoint runs; it is idempotent.

#### PostHog person not deleted (`account_delete_posthog_failed`)

Fires when `POST /api/account/delete` erased the user's data but PostHog's bulk-delete call (`api/account/_posthogErasure.ts`) returned an error or timed out after 5 seconds. The account is still deleted; only the analytics person and events may remain. `extra.reason` is `http_<status>` or the error name. `extra.distinctId` is the PostHog distinct_id (`hashIdentity(uid)`), which is the only handle left once the account is gone.

- **When:** A new issue is created
- **Filter:** `event.environment:production AND message:"account_delete_posthog_failed"`
- **Then:** Send notification to **Slack** `#skatehubba-alerts`
- **Action interval:** Every occurrence (each one is a deletion request PostHog has not acted on)
- **Skipped in production (`account_delete_posthog_skipped`):** same filter with this message. It fires when `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_PROJECT_ID` is missing in Vercel Production, so every deletion is missing PostHog. Set both, redeploy, then retry each `extra.distinctId` by hand as below. Outside production a skip is expected and only logged.
- **Remediation:** `http_401` or `http_403` means `POSTHOG_PERSONAL_API_KEY` is wrong, expired, or lacks `person:write`; `http_404` usually means a wrong `POSTHOG_PROJECT_ID` or `POSTHOG_HOST` (see `docs/DEPLOYMENT.md`). Fix the env, then retry by hand: `POST {POSTHOG_HOST}/api/projects/{POSTHOG_PROJECT_ID}/persons/bulk_delete/` with `{"distinct_ids": ["<extra.distinctId>"], "delete_events": true}` and the personal key as a Bearer token.

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
covers only the two map alerts. App Check is now on in production in monitor mode, so
these signals are live; add the rules before Console enforcement is turned on.
