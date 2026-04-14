# Sentry Error Monitoring & Alert Routing

## Overview

SkateHubba uses [@sentry/react](https://docs.sentry.io/platforms/javascript/guides/react/) for runtime error monitoring. The SDK is lazily loaded — it is only fetched when `VITE_SENTRY_DSN` is set.

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

When a user signs in, their Firebase UID is attached to all subsequent Sentry events via `setUser({ id: uid })`. This is cleared on sign-out. No PII (email, name) is sent — only the UID.

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

The `beforeSend` hook in `src/main.tsx` strips `email=` query parameters from event URLs. Only Firebase UIDs are attached as user context — no email addresses or display names are sent to Sentry.

## Verifying the Setup

1. Deploy with `VITE_SENTRY_DSN` set
2. Open the browser console and run: `throw new Error("Sentry test")`
3. Confirm the event appears in Sentry → **Issues** within ~30 seconds
4. Confirm alert notifications arrive in Slack/email
