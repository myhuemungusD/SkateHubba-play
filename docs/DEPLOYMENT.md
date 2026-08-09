# Deployment Guide

## Architecture

| Concern                   | Service                                     |
| ------------------------- | ------------------------------------------- |
| Code hosting              | Vercel (auto-deploys from GitHub)           |
| Auth + Database + Storage | Firebase (manual rules deployment required) |
| Stats close-out           | Firebase Cloud Functions (manual deploy)    |
| CI gate                   | GitHub Actions (type check → test → build)  |

---

## Initial Setup

If you're setting up for the first time, here's the full sequence:

1. **Create a Firebase project** in the [Firebase Console](https://console.firebase.google.com).
   - Enable Authentication: Email/Password and Google providers
   - Create a Firestore database named `"skatehubba"` (not the default name)
   - Enable Firebase Storage

2. **Add authorized domains** to Firebase Auth:
   Firebase Console → Authentication → Settings → Authorized domains
   Add: your production domain, `localhost` (for local dev), and any Vercel preview URLs you plan to use.

3. **Deploy security rules:**

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use <your-project-id>
   firebase deploy --only firestore:rules,storage
   ```

4. **Deploy the app to Vercel:**
   - Import the GitHub repo in the [Vercel Dashboard](https://vercel.com/new)
   - Framework: Vite (auto-detected)
   - Add all required environment variables (see below)
   - Deploy

---

## Environments

### Production

- Branch: `main`
- Vercel auto-deploys on every push to `main` that passes CI.
- Firebase project: `sk8hub-d7806`
- Domain: `skatehubba.com`

### Preview

Every PR and every non-`main` branch gets a Vercel preview URL automatically. Preview deployments use the same Firebase project as production. `X-Robots-Tag: noindex, nofollow` is injected on all preview URLs via `vercel.json` — they will not appear in search results.

---

## Routine Code Deployments

The normal development cycle:

```
feature branch → PR → CI passes → merge to main → Vercel auto-deploys
```

You don't need to do anything manually for code changes. Vercel picks up `main` automatically after merge.

**Note:** Vercel deploys only the built SPA. Changes to `firestore.rules` or `storage.rules` must be deployed separately — see below.

---

## Firebase Rules Deployment

Rules changes are **not** part of the Vercel pipeline — but they are **not manual either**.

> **They deploy automatically on merge to `main`.**
> `.github/workflows/firebase-rules-deploy.yml` triggers on any push to `main`
> touching `firestore.rules`, `firestore.indexes.json`, `storage.rules`,
> `firebase.json`, or `.firebaserc`. A daily `cron` re-deploys from `main` as a
> freshness guard, so a hand-rollback in the Firebase console is reverted within
> 24 hours — the fix for a bad rule is a revert commit, not a console edit.
>
> This paragraph previously claimed rules were deployed by hand. That was stale
> and actively dangerous: it invited safety checks to be written as runbook
> prose for a pipeline with no human in it. Any gate that matters belongs in the
> workflow (see the PII scan below), not here.

The commands below are for a **deliberate out-of-band deploy** — a rollback, a
first-time setup, or a deploy from a branch. Routine changes need none of it:

```bash
firebase use sk8hub-d7806
firebase deploy --only firestore:rules,storage
```

To deploy only one:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
```

**Verify the deployment:**

Firebase Console → Firestore → Rules tab → check the "Published rules" timestamp.

**Test before deploying:**

Firebase Console → Firestore → Rules → Rules Playground lets you simulate reads and writes against your rules before publishing them.

### PII scan gate (enforced in CI — you do not run this by hand)

`users/{uid}` is `get`-able by anyone, so a shared `/player/{uid}` link resolves
for a signed-out visitor. Firestore rules **cannot filter fields** — they allow
or deny whole documents — so that rule is only safe while no public user doc
still carries a sensitive field inline. The public/private split moved `email`,
`emailVerified`, `dob`, `parentalConsent`, and `fcmTokens` into the owner-only
`users/{uid}/private/profile`; a doc the backfill missed would become
**world-readable** the moment those rules publish, including the date of birth
of a minor.

Because rules deploy automatically, this is a **step in the deploy job**
(`Scan production for residual PII on public user docs`), not something to
remember. It runs `scripts/migrate-users-private.mjs --verify` against the
production project and exits non-zero on any residual field, failing the job
before `firebase deploy` runs.

It is **scoped to rules that actually contain the public read** (grepped for
`allow get: if true;`). Deploys that don't touch it run exactly as before, so
this can't become the step everyone learns to route around.

Behaviour:

- **With Workload Identity Federation** — the scan runs automatically against
  production. Any `LEAK <uid> still has: …` line fails the job; re-run the
  migration (`node scripts/migrate-users-private.mjs`, idempotent and
  resumable) and re-run the workflow.
- **With the legacy `FIREBASE_TOKEN`** — which is what this repo currently
  uses — the scan **cannot run**. `FIREBASE_TOKEN` is a firebase-tools refresh
  token and cannot authenticate the Admin SDK. The job fails with instructions
  rather than deploying an unverified public read.

  To unblock, either migrate to WIF (set `FIREBASE_WIF_PROVIDER` +
  `FIREBASE_WIF_SERVICE_ACCOUNT`, after which this is automatic), or run the
  scan by hand and re-run the workflow via `workflow_dispatch` with
  `pii_scan_verified = i-ran-the-scan`.

  That override is an honour system and is logged as a warning on the run. It
  exists so a solo maintainer isn't wedged; it is not a substitute for WIF.

To run it yourself against production — worth doing before opening a rules PR,
so you find out early rather than at deploy time:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
node scripts/migrate-users-private.mjs --verify
```

`verify: scanned=<n> offending=0` (exit 0) is the go signal.

**Known limitation, not yet closed:** the scan checks a _denylist_ of five known
field names. `users/{uid}` create/update rules likewise deny those five rather
than allowlisting known-good keys, so a sixth field written by a future code
path would be world-readable and neither the rules nor this scan would catch it.
Tracked as follow-up; the fix is `keys().hasOnly([...])` on the create/update
rules plus an allowlist-based scan.

---

## Cloud Functions Deployment

The stats close-out function under `functions/` is the one application-authored
Cloud Functions codebase — maintainer-approved (2026-07) to move win/loss stat
writes server-side after a client-side stats-replay path corrupted production
counters (see `docs/CHARTER.md §4.14`). Like rules, it is **not** part of the
Vercel pipeline and must be deployed deliberately.

```bash
firebase use sk8hub-d7806
firebase deploy --only functions
```

The `functions` block in `firebase.json` declares a `predeploy` hook that runs
`npm ci` and `npm run build` inside `functions/` before the upload, so the
deployed artifact always matches the committed lockfile and TypeScript source.
CI mirrors this on every PR that touches `functions/**` via the `build-functions`
job in `pr-gate.yml`.

To deploy a single function by name (the deployed export is `onGameCompleted`;
`applyGameStats` is the internal transaction module it calls):

```bash
firebase deploy --only functions:onGameCompleted
```

**Pre-deploy check — region co-location:** the trigger is pinned to
`us-central1` (`functions/src/index.ts`), which must match the `skatehubba`
named database's location or the trigger will never fire. Confirm with
`gcloud firestore databases describe --database=skatehubba` (expected:
`us-central1`, the same region pinned in `infra/firestore-backup.sh` and the
`firestore-send-fcm` extension env).

**Verify the deployment:**

Firebase Console → Functions → confirm the function's "Last deployed" timestamp
and that the newest revision is serving.

---

## Stats Backfill Runbook

Run this when first cutting the win/loss counters over to the server-maintained
model, or when reconciling counters after an incident. Because `wins`/`losses`
on `users/{uid}` are now written **only** by the Cloud Function (clients are
read-only), rollout order matters: deploy the enforcement boundary before the
writer, and the writer before the clients that depend on it.

**Rollout order (do not reorder):**

1. **Deploy Firestore rules.** `firebase deploy --only firestore:rules` — makes
   `wins`/`losses` and `games/{gameId}.statsApplied` client-read-only so no
   client can race the function. See [Firebase Rules Deployment](#firebase-rules-deployment).
2. **Deploy Cloud Functions.** `firebase deploy --only functions` — stand up the
   stats close-out writer. See [Cloud Functions Deployment](#cloud-functions-deployment).
3. **Deploy the client.** Merge to `main`; Vercel auto-deploys the SPA build that
   no longer writes `wins`/`losses` itself and instead reads them as authoritative.
4. **Backfill existing counters.** Run the one-off reconciliation script
   (`--dry-run` first, then live) to recompute `wins`/`losses` from completed
   games and stamp `statsApplied` on games that closed out before the function
   existed.

**Backfill script:**

The script uses the Admin SDK — point `GOOGLE_APPLICATION_CREDENTIALS` at a
service-account key JSON with Firestore access (Firebase Console → Project
Settings → Service accounts → Generate new private key). Never commit the key.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

# 1. Dry run first — prints the diffs it WOULD apply, writes nothing.
node scripts/backfill-stats.mjs --dry-run

# 2. Review the deltas, then run live.
node scripts/backfill-stats.mjs
```

Always run `--dry-run` first and eyeball the deltas before the live pass. The
backfill is idempotent because it is a **recompute-from-source overwrite**:
every run re-tallies all terminal games and rewrites every user's
`wins`/`losses` with the recount, so repeat runs converge to the same values
(`statsApplied` only lets the script skip the redundant game-flag write — it
does not exempt a game from the tally, and stamping it by hand will not
prevent a recount).

---

## Environment Variables

### Required (set in Vercel Dashboard for both Production and Preview scopes)

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID

VITE_MAPBOX_TOKEN    — Required for /map. Without this the map page renders
                       a "temporarily unavailable" fallback and a
                       `map_token_missing` warning is emitted to Sentry.
                       Get a public token from Mapbox Dashboard → Access Tokens.
```

### Optional

```
VITE_MAPBOX_STYLE_URL — Custom Mapbox style URL. Optional override consumed
                        by `src/lib/mapbox.ts`. Must either start with
                        `mapbox://styles/` (a Mapbox Studio style URI) or be
                        a valid `https://` URL pointing at a self-hosted style
                        JSON; any other value is rejected at startup, a
                        warning is logged to the browser console, a
                        `map_style_invalid` Sentry event is emitted with
                        the offending value attached, and the map falls
                        back to `mapbox://styles/mapbox/dark-v11` so a typo
                        can't take the /map page down. See
                        docs/MAPBOX_STYLE.md for the Mapbox Studio authoring
                        + publish steps. Leave unset to use
                        the default dark style. NOTE: a self-hosted https
                        style URL on a non-Mapbox origin also requires
                        adding that origin to the `connect-src` directive
                        in `vercel.json` — otherwise the CSP will block
                        the style fetch.

VITE_APP_URL         — Set to https://skatehubba.com in production.
                       Used as the redirect URL in Firebase email action links
                       (password reset, verification). Falls back to
                       window.location.origin if not set.

VITE_USE_EMULATORS   — Development only. Do NOT set this in Vercel.
                       Setting it in production will cause Firebase connections to fail.

FIREBASE_STORAGE_BUCKET
                     — Server-side only (no VITE_ prefix — never exposed to the
                       browser). Overrides the Storage bucket used by
                       `api/account/delete.ts` when erasing a deleted user's
                       videos and avatar. Defaults to
                       `${project_id}.firebasestorage.app`, derived from
                       FIREBASE_SERVICE_ACCOUNT_JSON — the same convention
                       `infra/storage-lifecycle.sh` uses. Only set this if the
                       bucket was created under the older `.appspot.com`
                       naming, in which case erasure would silently find no
                       objects to delete.

ACCOUNT_DELETE_ALLOWED_ORIGIN
                     — Server-side only. Adds one extra origin to the CORS
                       allowlist on `POST /api/account/delete`. Not needed for
                       the web app (same-origin) or for the built native apps
                       (the Capacitor origins are already allowlisted). Useful
                       when testing the native delete flow against a preview
                       deployment from a non-standard origin.
```

### Vercel scoping

Set `VITE_FIREBASE_*` and `VITE_MAPBOX_TOKEN` for both **Production** and **Preview** scopes — preview deployments need Firebase and the map to work for testing.

Set `VITE_APP_URL` for **Production only** — preview deployments have auto-generated URLs that you don't know in advance.

### Mapbox token hardening

Public Mapbox tokens (`pk.…`) are bundled into the client JS and visible to anyone viewing source. Restrict the token in the Mapbox dashboard to:

- `https://skatehubba.com/*` (production)
- `https://*.vercel.app/*` (preview deployments)
- `http://localhost:*/*` (local development)

Without a URL restriction a leaked token can be used to burn through your Mapbox tile quota.

Vercel does **not** redeploy on env-var changes. After adding `VITE_MAPBOX_TOKEN`, trigger a manual redeploy (Deployments → "…" → Redeploy) for the value to take effect.

---

## Cron Endpoints Runbook

Three scheduled GitHub Actions workflows call Vercel serverless endpoints with
admin credentials. When their configuration drifts, turn expiry, push
delivery, and dispute resolution all stop — silently from the player's point
of view (a game whose landed claim is under review stays frozen forever if
the dispute referee never runs). This section exists because exactly that
happened to the first two on 2026-07-27 (~24h outage).

| Endpoint                             | Workflow                                         | Schedule | Job                                      |
| ------------------------------------ | ------------------------------------------------ | -------- | ---------------------------------------- |
| `/api/cron/sweep-expired-turns`      | `.github/workflows/sweep-expired-turns.yml`      | \*/15min | Auto-forfeits expired turns              |
| `/api/cron/drain-push-dispatch`      | `.github/workflows/drain-push-dispatch.yml`      | \*/5min  | Delivers queued push notifications       |
| `/api/cron/resolve-expired-disputes` | `.github/workflows/resolve-expired-disputes.yml` | \*/15min | Resolves trick-dispute reviews and votes |

All three endpoints share the same auth (`CRON_SECRET` bearer), the same
service-account parser (`api/cron/_serviceAccount.ts`), and the same
`?dryRun=1` no-side-effects probe, so every pitfall and failure signature
below applies to each of them identically.

> **A fourth admin endpoint exists but is NOT a cron:**
> `POST /api/account/delete` erases a user's data with admin credentials and
> then deletes their Auth record. It is called by the app, not by a workflow,
> and it does **not** use `CRON_SECRET` — it authenticates the end user with a
> Firebase ID token (verified with `checkRevoked`, plus a 5-minute
> recent-sign-in requirement). It shares only the service-account parser and
> therefore the `FIREBASE_SERVICE_ACCOUNT_JSON` dependency: if that env var is
> missing or malformed, account deletion returns `500 init_failed` with the
> same root cause and the same fix as the cron `init_failed` below.
>
> Unlike the crons it also needs Storage access, to delete game videos and the
> avatar. Storage is Phase 1 of the cascade, so if the service account lacks
> Storage permissions or the bucket name is wrong (see `FIREBASE_STORAGE_BUCKET`
> above), the listing throws before any Firestore write and **nothing** is
> erased — the endpoint returns `500 erasure_failed` and the account is left
> completely intact. Symptom to look for: deletions failing for every user, not
> partially-deleted accounts. There is no `?dryRun=1` here: the operation is
> irreversible by design and must never be triggered casually.

### The two secrets

| Name                            | Set in                                                                                                             | Read by                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `CRON_SECRET`                   | **Both**: Vercel env (Production) AND GitHub → Settings → Secrets and variables → Actions → **Repository secrets** | Endpoint auth (bearer check) + workflow curl |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Vercel env (Production) only                                                                                       | firebase-admin init in both endpoints        |

Pitfalls, each observed in production:

- `CRON_SECRET` must be a GitHub **repository** secret. An _environment_
  secret is invisible to these jobs (they declare no `environment:`) and
  resolves to empty — the run log shows `CRON_SECRET:` blank instead of
  `***`, and the endpoint 401s.
- The two `CRON_SECRET` values must match byte-for-byte. A trailing space or
  newline from a copy-paste fails identically to a wrong value.
- `FIREBASE_SERVICE_ACCOUNT_JSON` is the **entire** service-account file
  (Firebase Console → Project settings → Service accounts → Generate new
  private key), pasted as a **single line**. Collapse it first so a clipboard
  cannot mangle the `\n` escapes inside `private_key`:

  ```bash
  jq -c . ~/Downloads/service-account.json | pbcopy
  ```

  The parser (`api/cron/_serviceAccount.ts`) repairs known paste damage
  (expanded newlines, smart quotes, CRLF) and logs a
  `service_account_json_repaired` warning when it does — treat that warning
  as "re-paste the value properly", not as normal operation.

- Vercel binds env vars at **deploy time**. After adding or changing either
  value, redeploy production (Deployments → "…" → Redeploy) or the running
  build keeps the old value and nothing appears to have changed.

### Verify after any change

Force a run instead of waiting for the schedule: Actions → the workflow →
Re-run jobs (or workflow_dispatch). Green + `HTTP 200` with a JSON summary
means the full chain works. To exercise an endpoint without side effects:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://skatehubba.com/api/cron/drain-push-dispatch?dryRun=1"
```

### Failure signatures

| Response                                             | Meaning                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `401 unauthorized` + blank `CRON_SECRET:` in run log | GitHub can't see the secret (wrong scope/name)                             |
| `401 unauthorized` + `CRON_SECRET: ***` in run log   | Values differ between GitHub and Vercel, or Vercel not redeployed          |
| `500 init_failed … is not set`                       | `FIREBASE_SERVICE_ACCOUNT_JSON` missing from the **running** deployment    |
| `500 init_failed … [value diagnostics: …]`           | Value unparseable beyond repair — the counts describe the paste damage     |
| `500 init_failed … implausible <field>`              | Paste damage in `project_id`/`client_email`/PEM that repair won't guess at |
| `service_account_json_repaired` warning, run green   | Working, but the stored value is damaged — re-paste it cleanly             |

Both workflows also skip on forks and fail loudly rather than masking curl
errors — see the comments in the workflow files before changing them.

---

## Rolling Back

### Roll back a code deployment

Vercel Dashboard → Project → Deployments → find a previous deployment → "Promote to Production." This is instant — no rebuild required.

### Roll back Firestore rules

Firebase does not support one-click rules rollback. Process:

1. Revert the change to `firestore.rules` in git.
2. `firebase deploy --only firestore:rules`

Keep rules changes in small, focused commits so reverting is straightforward.

---

## Monitoring

### Vercel

- **Deployments:** Vercel Dashboard → Project → Deployments (build logs, status)
- **Analytics:** Vercel Dashboard → Analytics (requires `@vercel/analytics`, already installed)

### Firebase

- **Auth:** Firebase Console → Authentication → Users (user growth, sign-in activity)
- **Firestore:** Firebase Console → Firestore → Usage (reads/writes/deletes per day)
- **Storage:** Firebase Console → Storage → Usage (stored size, bandwidth)

---

## Firebase Free Tier Limits (Spark plan)

| Resource           | Free limit   |
| ------------------ | ------------ |
| Firestore reads    | 50,000 / day |
| Firestore writes   | 20,000 / day |
| Firestore deletes  | 20,000 / day |
| Storage stored     | 5 GB         |
| Storage downloaded | 1 GB / day   |
| Authentication     | Unlimited    |

If you approach these limits, upgrade to the Blaze (pay-as-you-go) plan. Blaze has no fixed free tier but charges only for usage above the same thresholds.

---

## Troubleshooting

### "Firebase not configured" screen in production

The app shows this when `VITE_FIREBASE_API_KEY` is not set.

**Fix:** Vercel Dashboard → Project Settings → Environment Variables → verify the variable is set and scoped to the correct environment (Production / Preview).

### "Map is temporarily unavailable" on `/map`

The app shows this when `VITE_MAPBOX_TOKEN` is not set in the deployed build. A `map_token_missing` warning is emitted to Sentry on every page view in this state.

**Fix:**

1. Vercel Dashboard → Project Settings → Environment Variables → add `VITE_MAPBOX_TOKEN` (public token from Mapbox Dashboard → Access Tokens), scoped to Production **and** Preview.
2. Deployments → most recent deployment → "…" → Redeploy. Env var changes do not trigger an automatic rebuild.
3. Verify the Mapbox token is URL-restricted (see [Mapbox token hardening](#mapbox-token-hardening)).

### Build fails on `tsc -b`

Run `npx tsc -b` locally to see the errors. Fix type errors before pushing.

### Build fails on `npm test`

Run `npm test` locally — the suite must pass and `npm run test:coverage` must clear the 100% threshold on `src/services/**` and `src/hooks/**` before CI will approve the build.

### Firestore `permission-denied` error in production

Possible causes:

- Rules have not been deployed after a recent change: run `firebase deploy --only firestore:rules`
- The write violates a rule constraint: use the Rules Playground in the Firebase Console to simulate the write and check which rule is failing
- Wrong Firebase project: verify `firebase use` points to the correct project

### Firebase Auth "unauthorized domain" error

The domain making the auth request is not in Firebase Auth's authorized list.

**Fix:** Firebase Console → Authentication → Settings → Authorized domains → add the domain.

---

## Domain Migration: skatehubba.xyz → skatehubba.com

The production domain was migrated from `skatehubba.xyz` to `skatehubba.com`. All code references already use `.com`. The checklist below tracks the infrastructure cutover.

### Completed (in code)

- [x] All hardcoded URLs in `index.html`, `sitemap.xml`, `robots.txt` use `skatehubba.com`
- [x] `vercel.json` 301 redirects: `skatehubba.xyz`, `www.skatehubba.xyz`, and `www.skatehubba.com` → `skatehubba.com`
- [x] `X-Robots-Tag: noindex` applied to all hosts except `skatehubba.com`
- [x] `authDomain` left as the Firebase-provided `*.firebaseapp.com` value (passed through from `VITE_FIREBASE_AUTH_DOMAIN`). It is intentionally **not** overridden to `skatehubba.com`: Firebase email-verification / password-reset links resolve to `https://{authDomain}/__/auth/action`, which is served only by Firebase Hosting — pinning it to the Vercel domain would break every outbound email link (see the note in `src/firebase.ts`)

### Manual steps (require console / DNS access)

1. **Vercel — add both domains to the project:**
   Vercel Dashboard → Project → Settings → Domains
   - Add `skatehubba.com` as the primary domain
   - Add `skatehubba.xyz` (Vercel will serve the redirect rules from `vercel.json`)
   - Add `www.skatehubba.com` and `www.skatehubba.xyz` if not already present

2. **GoDaddy / DNS — point records to Vercel:**
   - `skatehubba.com` → Vercel (A record `76.76.21.21` or CNAME `cname.vercel-dns.com`)
   - `skatehubba.xyz` → Vercel (same target — Vercel will handle the 301)
   - Verify both domains show a green checkmark in Vercel Dashboard → Domains

3. **Firebase Auth — authorize `skatehubba.com`:**
   Firebase Console → Authentication → Settings → Authorized domains
   - Add `skatehubba.com` (required for OAuth popups/redirects to work on the new domain)
   - Keep `skatehubba.xyz` authorized until traffic fully migrates (optional, but prevents errors during the transition)

4. **Firebase Auth — custom domain for auth:**
   If using a custom auth domain (`VITE_FIREBASE_AUTH_DOMAIN=skatehubba.com` instead of the default `<project>.firebaseapp.com`), verify that Firebase has provisioned the TLS certificate:
   Firebase Console → Authentication → Settings → Authorized domains → confirm `skatehubba.com` is listed

5. **Google Cloud Console — OAuth redirect URIs:**
   Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs
   - Add `https://skatehubba.com/__/auth/handler` as an authorized redirect URI
   - Keep the `skatehubba.xyz` URI until cutover is verified

6. **Verify end-to-end:**
   - `curl -sI https://skatehubba.xyz` → should return `301` with `Location: https://skatehubba.com/`
   - Sign up with email on `skatehubba.com` → verification email link should point to `.com`
   - Sign in with Google on `skatehubba.com` → OAuth popup should work without "unauthorized domain" error
   - Confirm `skatehubba.xyz` no longer appears in Google Search Console (may take days)
