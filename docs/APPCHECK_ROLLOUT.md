# App Check Production Rollout — Staged Runbook

**Status:** App Check is built and OFF in production. This document is the
execution plan to turn it on without repeating the Apr 22 lockout.

**Audience:** solo maintainer, executing alone, in production.

**Incident context:** `docs/PERMISSION_DENIED_RUNBOOK.md` §0–1. Root cause of
Apr 22 was _Firebase Console enforcement ON_ + _reCAPTCHA domain allowlist
missing a domain the app actually served from_. Every signed-in user got
`permission-denied` on `users/{uid}`. Nothing in the client can prevent that —
enforcement is a server-side decision. The only defence is ordering: send
tokens first, verify the metric, enforce last.

---

## What the code already does (verified against `src/firebase.ts`)

| Question                               | Answer                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is App Check on by default?            | No. `src/firebase.ts:141` — `if (!env.VITE_APPCHECK_ENABLED)` skips init and logs `appcheck_skipped_opt_in_required` (`firebase.ts:144`).                                                                                                                                              |
| Does a client-side init failure crash? | No. Web branch wraps `initializeAppCheck()` in try/catch (`firebase.ts:205–220`); native branch has both `.catch()` and try/catch (`firebase.ts:169–203`). Firebase continues.                                                                                                         |
| Fail-open or fail-closed?              | **Client fails open. Server does not.** With Console enforcement **Unenforced**, a client that mints no token still reads/writes fine. With enforcement **Enforced**, a token failure = `permission-denied`, full stop. This is why Phase 1 exists.                                    |
| Can the client run in "monitor" mode?  | Yes — that is exactly Phase 1. Enforcement is a **Console** setting, independent of the client. The client sends tokens; Console counts them as verified/unverified and rejects nothing while Unenforced. The rollout below depends on this and it is a documented Firebase behaviour. |
| Kill switch?                           | Two, see [Kill switches](#kill-switches). Console enforcement toggle is instant; the env flip needs a redeploy (Vite inlines `VITE_*` at build time).                                                                                                                                  |
| Is `isAppCheckInitialized()` truthful? | Partially — see [Known gap](#known-gap-init-success--tokens-are-minting).                                                                                                                                                                                                              |

### Known gap: init success ≠ tokens are minting

`appCheckInitialized = true` is set immediately after `initializeAppCheck()`
returns (`firebase.ts:210`). That call is synchronous and only throws on a
malformed site key or a blocked reCAPTCHA loader. **A rejected token exchange
— wrong site key, domain not on the reCAPTCHA allowlist, exactly the Apr 22
failure — happens asynchronously inside the SDK and produces no Sentry event
and no log line.**

Consequence for this rollout: **the Firebase Console App Check metrics chart is
the only reliable Phase 1 signal.** Sentry tells you about init-time failures,
not exchange failures. Do not treat "no Sentry errors" as "tokens are good".
Do not proceed to Phase 2 on Sentry silence alone.

(Optional follow-up, not required for this rollout: a one-shot
`getToken(appCheck)` probe after init, reporting to Sentry on rejection. It is
a code change to `src/firebase.ts` and needs its own PR + coverage review;
Console metrics make the rollout safe without it.)

---

## Env vars (exact names — from `src/lib/env.ts:30–46`)

| Var                       | Value                 | Where                                                                     |
| ------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `VITE_APPCHECK_ENABLED`   | `true`                | Vercel → Production scope. Anything other than the literal `true` is off. |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v3 site key | Vercel → Production scope. Empty string is treated as unset.              |

Both are also read by `.github/workflows/android-aab.yml:77–78` from **GitHub
Actions secrets of the same names** — a separate switch from Vercel. See
[Native apps](#native-apps-ios--android).

---

## Phase 0 — Preflight (no user-visible change)

Do all of this before touching any toggle. Every item is a hard gate.

### 0.1 reCAPTCHA v3 key is registered to this Firebase project

1. Firebase Console → **Build → App Check → Apps** tab.
2. Confirm the **Web app** row shows provider **reCAPTCHA v3** and is
   registered (not "Not registered").
3. Copy the site key shown there. This is the value for
   `VITE_RECAPTCHA_SITE_KEY`.

### 0.2 Domain allowlist — this is the Apr 22 failure mode

1. Go to https://www.google.com/recaptcha/admin → select the key from 0.1 →
   **Settings → Domains**.
2. The list MUST contain:
   - `skatehubba.com`
   - `www.skatehubba.com`
3. **A domain the app actually serves from that is missing here = tokens are
   issued and then rejected server-side = the Apr 22 lockout.** Do not skip.
   Note `vercel.json:19–24` 301-redirects `www.skatehubba.com` →
   `skatehubba.com`, so `www` should never mint tokens in practice — list it
   anyway, it costs nothing and covers a redirect regression.
4. Save, then wait ~60 s for propagation before any verification step.

### 0.3 Vercel preview deployments — decide explicitly

Vercel previews serve from `*.vercel.app`. reCAPTCHA matches subdomains, so
adding `vercel.app` to the allowlist would let **any** site on `vercel.app` use
your key. Do not do that.

Pick one:

- **Recommended:** leave `VITE_APPCHECK_ENABLED` **unset in the Preview scope**
  in Vercel. Previews then take the `firebase.ts:141` skip path and keep
  working unchanged. Production-only rollout, zero preview risk.
- If previews must send tokens: assign a stable custom preview domain
  (Vercel → Settings → Domains → e.g. `preview.skatehubba.com`), add that
  exact hostname to the reCAPTCHA allowlist, and set the env in the Preview
  scope. Per-deployment `*.vercel.app` URLs will still fail — accept that.

E2E (`npm run test:e2e`) runs against emulators where the debug-token path
applies (`firebase.ts:131–138`, gated on `useEmulators`), so CI is unaffected
either way.

### 0.4 CSP already allows App Check + reCAPTCHA

Verified in `vercel.json:80-81` — no change needed:

- `script-src` includes `https://www.google.com` and `https://www.gstatic.com`
  (reCAPTCHA loader).
- `frame-src` includes `https://www.google.com` (reCAPTCHA anchor frame).
- `connect-src` includes `https://firebaseappcheck.googleapis.com` and
  `https://content-firebaseappcheck.googleapis.com` (token exchange).

One thing to watch, not to pre-fix: `style-src` has no `'unsafe-inline'`, so
the reCAPTCHA badge's injected stylesheet may be blocked and the badge may not
render. Token minting is unaffected (the scoring iframe is cross-origin).
If the badge is missing, satisfy Google's attribution requirement with the
permitted text disclosure — **do not add `'unsafe-inline'` to `style-src`**;
that reopens finding F6 (`docs/archive/AUDIT_2026-05.md`).

### 0.5 Console enforcement is currently OFF

Firebase Console → **App Check → APIs** tab. Confirm **Cloud Firestore** and
**Cloud Storage for Firebase** both read **Unenforced**. If either is
Enforced right now, set it to Unenforced before Phase 1 — you cannot get a
clean monitor baseline otherwise.

### 0.6 Baseline the metric

App Check → **APIs → Cloud Firestore → Metrics**. Record today's
verified/unverified split. With the client off it should be ~100 % unverified.
Screenshot it; it is the denominator for Phase 1.

**Phase 0 abort:** any of 0.1, 0.2, 0.5 failing. Fix, wait 60 s, re-check.
Nothing has changed for users at this point, so there is no rollback.

---

## Phase 1 — Token-only (Console enforcement stays OFF)

Goal: the client mints and sends tokens; nothing is rejected. Zero user-facing
risk _provided 0.5 is true_.

### Execute

1. Vercel → `play` project → **Settings → Environment Variables**.
2. Add / set, **Production scope only**:
   - `VITE_RECAPTCHA_SITE_KEY` = key from 0.1
   - `VITE_APPCHECK_ENABLED` = `true`
3. **Deployments → most recent Production → ⋯ → Redeploy** (env vars are
   inlined at build time; saving the var alone changes nothing).
4. When the deploy is live, note the deployment ID/URL. You need it for the
   fast rollback in [Kill switches](#kill-switches).

### Verify within 10 minutes

1. Load https://skatehubba.com in a fresh incognito window, sign in.
2. DevTools → Network → filter `firebaseappcheck` → expect a
   `POST .../exchangeRecaptchaV3Token` returning **200**. A 403/400 here is a
   site-key or allowlist problem → abort.
3. DevTools → Console → expect **no** `appcheck_init_failed` and no
   `appcheck_enabled_but_no_site_key`. In production the logger emits
   structured JSON (`src/services/logger.ts:44`), so grep the raw string.
4. Sanity: the app loads the profile normally, no retry screen.

### Watch for 48–72 h

**Firebase Console — the authoritative signal:**
App Check → APIs → **Cloud Firestore → Metrics**, and the same for **Cloud
Storage for Firebase**. Target: **verified requests > 95 %**, sustained across
a full weekday + weekend cycle. Do not average away a bad day.

**Sentry — exact strings emitted by `src/firebase.ts`:**

| String                                                                          | Source                | Meaning                                                                               |
| ------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `appcheck_init_failed`                                                          | `firebase.ts:215`     | Web init threw — bad site key or blocked reCAPTCHA loader.                            |
| `App Check init failed — Auth/Firestore requests may be rejected:`              | `firebase.ts:216`     | Sentry `captureMessage` for the above. **Abort trigger.**                             |
| `appcheck_enabled_but_no_site_key`                                              | `firebase.ts:225`     | Env flipped without the key. **Abort trigger.**                                       |
| `App Check opt-in is set but VITE_RECAPTCHA_SITE_KEY is missing — init skipped` | `firebase.ts:228`     | Sentry message for the above.                                                         |
| `appcheck_skipped_opt_in_required`                                              | `firebase.ts:144`     | Client still OFF — the redeploy did not pick up the env var.                          |
| `appcheck_native_initialized`                                                   | `firebase.ts:178`     | Native attestation OK (breadcrumb, informational).                                    |
| `appcheck_native_init_failed` / `appcheck_native_init_threw`                    | `firebase.ts:184,196` | Native attestation broken. **Abort trigger for native.**                              |
| `users/{uid} permission-denied after retries`                                   | `useAuth.ts:121`      | The Apr 22 signature. `extra.appCheckInitialized` disambiguates. **Immediate abort.** |

Any occurrence of `users/{uid} permission-denied after retries` during Phase 1
means something _other_ than the client is enforcing — go to
`docs/PERMISSION_DENIED_RUNBOOK.md` §1 and re-check 0.5.

### Phase 1 abort criteria

- Verified-request rate below 95 % after 72 h.
- Any `appcheck_init_failed` / `appcheck_enabled_but_no_site_key` in Sentry.
- Any `users/{uid} permission-denied after retries`.
- `exchangeRecaptchaV3Token` returning non-200 in the manual check.

### Phase 1 rollback

1. Vercel → Deployments → the pre-flip Production deployment → **Instant
   Rollback**. Restores a bundle built without the flag. ~seconds, no build.
2. Then, at leisure: Settings → Environment Variables → set
   `VITE_APPCHECK_ENABLED` = `false` (or delete it) so the next deploy does not
   re-introduce it.
3. Confirm `appcheck_skipped_opt_in_required` reappears in the console log.

---

## Phase 2 — Enforce

Only after Phase 1 held **> 95 % verified for 48–72 h** on **both** Firestore
and Storage metrics.

### Pre-flight for Phase 2

- Both metrics > 95 %. Storage is often lower than Firestore because it sees
  less traffic — check it separately, do not infer it.
- [Native apps](#native-apps-ios--android) section resolved.
- You are at a keyboard, on a weekday, not about to travel. Enforcement is
  instant and global.

### Execute — one API at a time

1. Firebase Console → App Check → **APIs** tab → **Cloud Firestore** →
   **Enforce**.
2. Immediately: incognito → https://skatehubba.com → sign in → confirm the
   profile loads and a game screen renders.
3. Watch Sentry for 60 minutes. Specifically
   `users/{uid} permission-denied after retries`.
4. If clean after 24 h, repeat 1–3 for **Cloud Storage for Firebase**, then
   exercise a video upload end-to-end (record → upload → playback).

### Phase 2 abort criteria

- Any `users/{uid} permission-denied after retries` post-enforcement.
- Any user report of the "Couldn't load your profile" retry screen.
- Verified-request rate dropping below 95 % after enforcement.
- Video upload failing with `permission-denied` (Storage enforcement).

### Phase 2 rollback — order matters

1. **FIRST: Firebase Console → App Check → APIs → the enforced API →
   Unenforced.** Instant, global, no deploy. This alone ends the outage.
2. Verify recovery in incognito.
3. **Only then**, if the client itself is implicated (Sentry shows
   `appcheck_init_failed`), do the Phase 1 rollback (Vercel Instant Rollback).

Never start a Vercel redeploy while users are locked out — a build takes
minutes, the Console toggle takes seconds.

---

## Kill switches

| Switch                                          | Latency | Scope                    | Use when                                        |
| ----------------------------------------------- | ------- | ------------------------ | ----------------------------------------------- |
| Console → App Check → APIs → **Unenforced**     | seconds | server, all clients      | **Always first** during a lockout.              |
| Vercel **Instant Rollback** to pre-flip deploy  | seconds | web clients on next load | Client is minting bad tokens / noisy Sentry.    |
| `VITE_APPCHECK_ENABLED=false` + redeploy        | minutes | web clients              | Durable follow-up so the next deploy stays off. |
| GitHub secret `VITE_APPCHECK_ENABLED` + new AAB | days    | native                   | Not a kill switch. See below.                   |

---

## Native apps (iOS / Android)

`src/firebase.ts:147–203` takes a completely different path on Capacitor:
`@capacitor-firebase/app-check` → Play Integrity (Android) / DeviceCheck (iOS).

Three things that will bite:

1. **The flag is baked into the shipped binary.** `android-aab.yml:73–74` reads
   `VITE_APPCHECK_ENABLED` / `VITE_RECAPTCHA_SITE_KEY` from **GitHub Actions
   secrets**, at build time. A build already in the field cannot be flipped.
2. **Therefore Phase 2 enforcement locks out any installed native build that
   does not already mint tokens** — and the only remedy is Console rollback,
   because you cannot ship an app-store update in minutes.
3. Play Integrity / DeviceCheck must be **registered separately** in Firebase
   Console → App Check → Apps (Android and iOS rows), with the Play Integrity
   link to the Play Console app.

**Decision required before Phase 2:**

- If **no native build is in users' hands** — proceed web-only. Set the GitHub
  secret `VITE_APPCHECK_ENABLED=true` before the _first_ store release so it
  ships token-enabled from day one.
- If **a native build is live** — do a full Phase 0/1 for native first: ship an
  AAB/IPA built with the secret set, wait for adoption of that version (Play
  Console → Statistics → by app version) to clear ~95 %, confirm
  `appcheck_native_initialized` appears in Sentry and `appcheck_native_init_failed`
  does not, and only then enforce. Users on older versions will be locked out
  at enforcement regardless — that is a forced-update decision, not a
  rollout detail.

---

## Final checklist

| ✔   | Phase | Step                                                                                      |
| --- | ----- | ----------------------------------------------------------------------------------------- |
| ☐   | 0.1   | Web app registered with reCAPTCHA v3 in Console → App Check → Apps; site key copied       |
| ☐   | 0.2   | reCAPTCHA allowlist contains `skatehubba.com` **and** `www.skatehubba.com`                |
| ☐   | 0.3   | Preview scope decision made (recommended: leave `VITE_APPCHECK_ENABLED` unset in Preview) |
| ☐   | 0.4   | CSP confirmed unchanged in `vercel.json:80-81`; no `'unsafe-inline'` added                |
| ☐   | 0.5   | Firestore **and** Storage enforcement confirmed **Unenforced**                            |
| ☐   | 0.6   | Baseline metrics screenshotted                                                            |
| ☐   | 1     | `VITE_RECAPTCHA_SITE_KEY` set in Vercel Production scope                                  |
| ☐   | 1     | `VITE_APPCHECK_ENABLED=true` set in Vercel Production scope                               |
| ☐   | 1     | Production redeployed; pre-flip deployment ID recorded for Instant Rollback               |
| ☐   | 1     | `exchangeRecaptchaV3Token` returns 200 in incognito                                       |
| ☐   | 1     | No `appcheck_init_failed` / `appcheck_enabled_but_no_site_key` in Sentry                  |
| ☐   | 1     | Firestore verified-request rate > 95 % sustained 48–72 h                                  |
| ☐   | 1     | Storage verified-request rate > 95 % sustained 48–72 h                                    |
| ☐   | 2     | Native decision resolved (web-only, or native rolled out first)                           |
| ☐   | 2     | Cloud Firestore set to **Enforce**; verified in incognito                                 |
| ☐   | 2     | 24 h clean on Firestore (no `users/{uid} permission-denied after retries`)                |
| ☐   | 2     | Cloud Storage set to **Enforce**; video upload verified end-to-end                        |
| ☐   | post  | `docs/PERMISSION_DENIED_RUNBOOK.md` §0 updated to reflect the new default                 |
| ☐   | post  | `docs/archive/AUDIT_2026-05.md` F5 / issue #338 closed                                    |

---

## Related

- `docs/PERMISSION_DENIED_RUNBOOK.md` — §0 current default, §1 App Check vs
  reCAPTCHA triage. Use this during an incident; use the present doc to plan.
- `docs/archive/AUDIT_2026-05.md` F5 — the tracked finding this rollout closes.
- `src/firebase.ts:116–230` — the init path, all log strings.
- `src/lib/env.ts:30–46` — env parsing (empty string = unset).
- `.github/workflows/android-aab.yml:77–78` — native build-time flag.
