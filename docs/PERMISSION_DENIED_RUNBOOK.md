# Firestore `permission-denied` Runbook

When sign-in users land on the **"Couldn't load your profile"** retry screen and the
surfaced error is `Error: permission-denied`, follow this runbook in order. The
client-side retries (~10 s across 4 attempts with force-refreshed ID tokens) are
already exhausted — something on the backend is rejecting the read.

The read that fails is `users/{uid}` in the named database **`skatehubba`**. The
Firestore rule is literally `allow read: if isSignedIn();` (see `firestore.rules`,
`match /users/{uid}` block), so a signed-in user should always be allowed. If
they're getting `permission-denied` anyway, one of the four causes below is the
culprit.

## 0. Current default — App Check is OFF

As of the Apr 22 incident, App Check is **opt-in**: `src/firebase.ts` only calls
`initializeAppCheck()` when `VITE_APPCHECK_ENABLED=true` is set in the Vercel
environment. Default builds skip App Check entirely — users can sign in without
the client ever minting an App Check token.

**If sign-in is still broken despite App Check being off client-side**, Firebase
Console's server-side enforcement is likely rejecting requests that arrive
without an App Check header. Firebase Console → App Check → APIs → Cloud
Firestore → flip **Enforcement** to **Unenforced**. (Re-enforce only after
turning client-side App Check back on AND verifying the reCAPTCHA allowlist.)

**To turn App Check back on** once reCAPTCHA + enforcement are verified healthy:

1. Vercel Dashboard → `play` project → **Settings → Environment Variables**.
2. Set `VITE_APPCHECK_ENABLED=true` (plus a valid `VITE_RECAPTCHA_SITE_KEY`) in the
   **Production** scope.
3. Redeploy. Watch the App Check "verified requests" metric — it should climb to
   > 95 % before Firestore enforcement is flipped back on.

## 1. App Check enforcement vs. reCAPTCHA health

This is by far the most common cause.

- **Firebase Console → Build → App Check → APIs tab**
  - Check the **Enforcement** status of **Cloud Firestore** and **Cloud Storage for Firebase**.
  - If either is **Enforced**, every request needs a valid App Check token.
  - Over in **Metrics**, look at the "Verified requests" rate. If it's below ~95 %,
    the client is failing to mint tokens and enforcement is blocking everything.

- **reCAPTCHA admin console → your v3 site key**
  - https://www.google.com/recaptcha/admin
  - Confirm the key referenced by `VITE_RECAPTCHA_SITE_KEY` has both
    `skatehubba.com` **and** `www.skatehubba.com` in the **Domains** allowlist.
  - Missing a domain = tokens are issued but rejected server-side = `permission-denied`.

- **Vercel env var sanity**
  - `VITE_RECAPTCHA_SITE_KEY` must be set in the **Production** scope.
  - Vercel exposes unset env vars as `""` (empty string) — the env parser already
    treats that as unset (`src/lib/env.ts`), but confirm it's actually populated.

**Fix path:** If enforcement is on and the reCAPTCHA key allowlist is missing
domains, add the domains → wait ~60 s → retry. If metrics show low verified-request
rate even after the allowlist is correct, flip enforcement to **Unenforced** while
you debug, or set `VITE_APPCHECK_ENABLED=false` as in step 0.

## 2. Rules deployed to the right database?

The client hits the named database **`skatehubba`** (see `src/firebase.ts`, third
arg to `initializeFirestore`). Rules must be deployed to that named DB — NOT the
`(default)` database.

- `firebase.json` currently specifies `"database": "skatehubba"` under the
  `firestore` block — that's what routes `firebase deploy --only firestore:rules`
  to the named DB.
- `.github/workflows/firebase-rules-deploy.yml` runs on every push to `main` that
  touches `firestore.rules` / `firebase.json` / `.firebaserc`.

**Verify:** GitHub Actions → Workflows → **Deploy Firebase Rules** → check the most
recent run against `main`. It should be green. If the last run is red or hasn't run
since `firebase.json` gained the `"database": "skatehubba"` line, rules on the
named DB are stale or missing.

**Fix path:** Re-run the workflow manually (workflow_dispatch) or deploy locally:

```bash
npx firebase-tools@14 deploy --project <project-id> --only firestore:rules
```

## 3. Is the named `skatehubba` database created in the Firebase project?

Named databases must exist before they can be used.

- **Firebase Console → Build → Firestore Database**
  - Top-left DB picker → confirm a database named **`skatehubba`** is present.
  - If only `(default)` exists, the client's call to
    `initializeFirestore(app, {...}, "skatehubba")` is talking to a database that
    isn't there, which the SDK surfaces as `permission-denied`.

**Fix path:** Create the database in Firebase Console if it doesn't exist, then
re-run the rules deploy.

## 4. The user is genuinely signed out

Firebase Auth can go stale: signed-in-then-revoked in another tab, token expired
past refresh window, or corrupted IndexedDB persistence. The retry screen's error
line shows the UID the client thinks it has; if that looks wrong, the user's auth
state is the issue.

**Fix path:** User taps **Sign out** on the retry screen → signs in again. If that
doesn't help, ask them to clear site data (Chrome DevTools → Application → Storage
→ Clear site data) and retry.

## What the retry screen shows

After these changes, the retry screen renders:

- The exact Firestore error code (`permission-denied`, `unavailable`, etc.)
- The client's view of the signed-in UID

Take a screenshot of that screen when troubleshooting and you'll almost always
know which of the four causes above to investigate first.
