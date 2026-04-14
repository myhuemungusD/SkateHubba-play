# Deployment Guide

## Architecture

| Concern                   | Service                                     |
| ------------------------- | ------------------------------------------- |
| Code hosting              | Vercel (auto-deploys from GitHub)           |
| Auth + Database + Storage | Firebase (manual rules deployment required) |
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

Rules changes are **not** part of the Vercel pipeline. This is intentional — rules are a security boundary and should be deployed deliberately after review.

After any change to `firestore.rules` or `storage.rules`:

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
VITE_MAPBOX_STYLE_URL — Custom Mapbox Studio style URL. Defaults to
                        mapbox://styles/mapbox/dark-v11 if unset.

VITE_APP_URL         — Set to https://skatehubba.com in production.
                       Used as the redirect URL in Firebase email action links
                       (password reset, verification). Falls back to
                       window.location.origin if not set.

VITE_USE_EMULATORS   — Development only. Do NOT set this in Vercel.
                       Setting it in production will cause Firebase connections to fail.
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

Run `npm test` locally. All 45+ tests must pass before CI will approve the build.

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
- [x] `authDomain` pinned to `skatehubba.com` in production builds (prevents OAuth redirect mismatch if a user reaches the app via the old domain before the redirect fires)

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
