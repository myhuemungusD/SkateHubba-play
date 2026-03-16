# Auth Flow & Google OAuth — Deep Security Audit

**Date:** 2026-03-16
**Scope:** Full authentication system — email/password, Google OAuth, session management, Firestore security rules, CSP headers, account lifecycle
**Auditor:** Chief Dev Level Review

---

## Executive Summary

The SkateHubba auth system is **well-architected for its threat model** — a Firebase-first SPA with no custom backend. The decision to delegate auth entirely to Firebase Auth and enforce authorization via Firestore Security Rules eliminates entire vulnerability classes (server-side injection, session hijacking via custom session stores, auth bypass via middleware misconfiguration).

**Overall grade: B+**

There are no critical vulnerabilities. There are several medium-severity hardening opportunities and a few low-severity items documented below.

---

## Architecture Overview

```
User ──► React SPA ──► Firebase Auth (email/password + Google OAuth)
                   ──► Firestore (via Security Rules)
                   ──► Firebase Storage (via Storage Rules)
```

- **No custom backend.** No Express, no serverless functions, no REST API.
- **Security boundary:** Firestore Security Rules + Storage Rules (not client code).
- **Token management:** Firebase SDK handles JWT lifecycle automatically (IndexedDB, ~1hr expiry, auto-refresh).
- **Hosting:** Vercel with hardened security headers.

---

## Detailed Findings

### 1. Google OAuth Implementation

**File:** `src/services/auth.ts:92-124`

#### What's done right:

- `select_account` prompt forced — prevents silent session fixation
- Popup-first with redirect fallback — graceful degradation for mobile/Safari
- Error differentiation: `popup-blocked`, `popup-closed-by-user`, `account-exists-with-different-credential`, `unauthorized-domain` all handled distinctly
- Redirect resolution on mount (`resolveGoogleRedirect`) with Sentry reporting

#### Finding [MEDIUM]: No `nonce` parameter on Google OAuth

The `GoogleAuthProvider` is created without a `nonce` or `login_hint`. While Firebase handles CSRF internally via its `__session` cookie and state parameter, adding a nonce provides defense-in-depth against token replay:

```typescript
// Current (auth.ts:92-97)
function makeGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
```

**Risk:** Low in practice — Firebase's OAuth state parameter already prevents CSRF. But a nonce would add an extra layer.

**Recommendation:** Consider adding `provider.setCustomParameters({ prompt: "select_account", nonce: crypto.randomUUID() })` if your Firebase version supports nonce verification.

#### Finding [LOW]: Redirect error swallowed as `null`

In `resolveGoogleRedirect()` (auth.ts:145-167), errors are caught and return `null` rather than propagating:

```typescript
catch (err) {
  captureException(err, { extra: { context: "resolveGoogleRedirect" } });
  return null;  // Silently fails
}
```

The `GameContext.tsx` has its own catch that surfaces the error to the user, but the auth service itself silently recovers. This is acceptable but means the caller must always handle both `null` (no redirect pending) and catch (redirect failed) — which `GameContext.tsx` does correctly.

**Verdict:** Acceptable as-is. The two-layer error handling (service + context) is solid.

---

### 2. Email/Password Authentication

**File:** `src/services/auth.ts:49-67`, `src/screens/AuthScreen.tsx`

#### What's done right:

- Firebase's built-in bcrypt hashing (client never sees algorithm)
- Email verification required before gameplay (enforced in Firestore rules, not just client-side)
- Password minimum 6 chars (Firebase default) + strength indicator on signup
- Verification email is fire-and-forget with Sentry alerting on failure
- Password reset doesn't reveal whether email exists ("Reset email sent if account exists")

#### Finding [MEDIUM]: No rate limiting on email/password sign-in attempts

There is no client-side throttling on `signIn()` calls. Firebase Auth has built-in rate limiting (blocks after ~5 failed attempts per IP), but:

- The client provides no feedback about being rate-limited
- No exponential backoff or lockout indicator
- `auth/too-many-requests` error is not explicitly handled in `AuthScreen.tsx`

```typescript
// AuthScreen.tsx:61-78 — no case for auth/too-many-requests
else setError(getUserMessage(err, "Something went wrong"));
```

**Recommendation:** Add explicit handling for `auth/too-many-requests`:

```typescript
else if (code === "auth/too-many-requests")
  setError("Too many attempts. Please wait a few minutes.");
```

#### Finding [LOW]: Password strength indicator is purely cosmetic

`pwStrength()` in `helpers.ts:65-73` returns weak/fair/strong but doesn't block submission of weak passwords. A user can submit a 6-character all-lowercase password (rated "Weak") without any warning.

**Risk:** Low — Firebase enforces 6-char minimum server-side. The indicator exists for UX guidance.

**Recommendation:** Consider showing a soft warning when submitting with strength=1, or requiring strength >= 2 for signup.

---

### 3. Session & Token Management

#### What's done right:

- Firebase SDK manages ID tokens automatically (IndexedDB, not localStorage/cookies)
- Persistent multi-tab cache (`persistentMultipleTabManager`) prevents auth desync between tabs
- No custom session store = no session fixation/hijacking attack surface
- Token auto-refresh before expiry

#### Finding [MEDIUM]: No token revocation check beyond Firebase's ~1hr window

Firebase ID tokens are valid for ~1 hour. If a user's account is compromised and the password is changed, the old session remains valid until the token expires. Firebase doesn't push revocation — it only takes effect on the next token refresh.

**Risk:** This is a known Firebase Auth limitation, not a code bug. But it means:

- Account compromise has a ~1hr window where the attacker's session persists
- `deleteAccount()` doesn't force-invalidate other sessions before deletion

**Recommendation:** For high-security scenarios, consider calling `auth.currentUser.getIdToken(true)` periodically (e.g., on app focus) to force token refresh and catch revocations sooner.

#### Finding [LOW]: E2E test auth exposure

```typescript
// firebase.ts:82
(globalThis as Record<string, unknown>).__e2eFirebaseAuth = auth;
```

This is gated by `import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true"`, so it's tree-shaken from production builds by Vite. **No action needed** — but worth a periodic check that the condition is never accidentally broadened.

---

### 4. Firestore Security Rules

**File:** `firestore.rules`

#### What's done right:

- `isSignedIn()` + `isOwner(uid)` helper pattern — clean, consistent
- Username immutability enforced server-side (lines 39-40)
- Username reservation is atomic via transaction + rules preventing overwrites
- Username format enforced in rules: `[a-z0-9_]+`, 3-20 chars (matches client-side validation)
- Game creation requires `email_verified == true` (line 74) — **critical** for preventing abuse
- Self-challenge prevention: `player2Uid != request.auth.uid` (line 77)
- Score manipulation prevention: at most one letter gained per update (lines 110-121)
- Player UID immutability in game updates (lines 98-101)
- Rate limiting on game creation: 30s cooldown via `lastGameCreatedAt` (lines 86-90)

#### Finding [MEDIUM]: Profile read is too permissive

```
// firestore.rules:27
allow read: if isSignedIn();
```

Any authenticated user can read any other user's profile (email, username, stance, emailVerified, createdAt). The email field leaks PII.

**Risk:** An attacker with a valid account can enumerate all user profiles and harvest email addresses. The `SECURITY.md` acknowledges username enumeration is by design, but email enumeration is a separate concern.

**Recommendation:** Either:

1. Remove `email` from the UserProfile document (it's already on the Firebase Auth record)
2. Use Firestore field-level rules or a Cloud Function to strip email from reads by non-owners
3. At minimum, document this as an accepted risk

#### Finding [LOW]: No `exists()` check on profile create prevents double-write

Actually — this IS checked: `&& !exists(/databases/$(database)/documents/users/$(uid))` on line 30. Well done.

#### Finding [LOW]: Game delete is broad

```
// firestore.rules:154
allow delete: if isSignedIn() && isPlayer(resource.data);
```

Either player can delete a game at any time (active or completed). This is intentional for account deletion cleanup, but could be abused to destroy game history. The `SECURITY.md` doesn't list this as a known limitation.

**Recommendation:** Consider restricting delete to only the account-deletion flow (e.g., require game status to not be 'active', or use a batch delete via Cloud Function).

---

### 5. Storage Security Rules

**File:** `storage.rules`

#### What's done right:

- Auth required for all operations
- File size bounds: 1KB min (prevents stubs), 50MB max
- Content-type locked to `video/webm`
- Filename restricted to `(set|match)\.webm` — prevents path traversal
- Default deny-all for unmatched paths

#### Finding [MEDIUM]: Any authenticated user can read any game's videos

```
// storage.rules:11
allow read: if request.auth != null;
```

Storage rules don't verify game membership. If you know a `gameId`, you can download the videos even if you're not a player. The `SECURITY.md` acknowledges this (line 79) and correctly notes that the URL can't be injected into Firestore without being a player.

**Risk:** Video content leakage if game IDs are predictable or shared. Game IDs are Firestore auto-generated (20 chars, cryptographically random), so brute-force is infeasible.

**Verdict:** Accepted risk with adequate documentation. No action required.

#### Finding [LOW]: Any authenticated user can upload to any game path

Same issue as reads — storage rules can't cross-reference Firestore. An attacker could upload garbage to `games/{knownGameId}/turn-1/set.webm`. However, they can't write the URL into the Firestore game document (rules prevent it), so the upload would be orphaned.

**Verdict:** Accepted risk. The orphaned files could be cleaned up with a lifecycle rule or Cloud Function.

---

### 6. Security Headers (Vercel)

**File:** `vercel.json`

#### What's done right:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — excellent, 2-year HSTS
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin` — good balance
- `Permissions-Policy` locks down camera/mic to self, disables geolocation/payment
- `X-Robots-Tag: noindex, nofollow` for non-production hosts
- **CSP is comprehensive and well-scoped**

#### CSP Analysis:

```
default-src 'self';
script-src 'self' 'unsafe-inline';         ← see finding below
style-src 'self' 'unsafe-inline' fonts;
connect-src 'self' firebase/sentry/vercel;  ← properly scoped
frame-src 'self' accounts.google.com;       ← needed for OAuth popup
img-src 'self' data: blob: firebase/google; ← google profile pics
media-src 'self' blob: firebase;
object-src 'none';                          ← excellent
base-uri 'self';                            ← prevents base tag injection
form-action 'self';                         ← prevents form hijacking
```

#### Finding [MEDIUM]: `script-src 'unsafe-inline'` weakens CSP

The CSP allows `'unsafe-inline'` for scripts. This is likely needed for Vite's dev mode and the inline service worker unregistration script in `index.html:46-53`:

```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(...)
  }
</script>
```

**Risk:** `unsafe-inline` allows XSS payloads to execute if an attacker can inject HTML. Combined with `object-src 'none'` and the React rendering model (which escapes by default), actual exploitation requires a very specific injection vector.

**Recommendation:**

1. Move the SW unregistration script to a separate `.js` file
2. Replace `'unsafe-inline'` with a `nonce`-based or `'strict-dynamic'` policy
3. If Vite requires `unsafe-inline` in production, investigate the `@vitejs/plugin-legacy` CSP options

#### Finding [INFO]: No `frame-ancestors` directive

`X-Frame-Options: DENY` covers this, but adding `frame-ancestors 'none'` to the CSP would provide the CSP-native equivalent for browsers that prefer it.

---

### 7. Account Deletion Flow

**File:** `src/context/GameContext.tsx:215-243`

#### What's done right:

- Auth deletion runs FIRST — if it fails (e.g., requires-recent-login), Firestore data is preserved
- `auth/requires-recent-login` is caught and surfaced to the user with a clear message
- Firestore cleanup (profile + username + games) runs as best-effort after auth deletion
- Atomic transaction for profile + username deletion

#### Finding [LOW]: Firestore cleanup may fail silently after auth deletion

If `deleteAccount()` succeeds but `deleteUserData()` throws, the user's auth account is gone but Firestore data remains orphaned:

```typescript
await deleteAccount(); // Auth deleted
await deleteUserData(activeProfile.uid, activeProfile.username); // May fail
```

The code comment acknowledges this ("best effort"). The orphaned data is benign (username is released when the reservation doc is deleted), but if it fails, the username remains permanently reserved.

**Recommendation:** Log a Sentry alert if `deleteUserData()` fails after successful auth deletion, so the ops team can manually clean up.

---

### 8. Client-Side Auth Routing

**File:** `src/context/GameContext.tsx:155-175`

#### What's done right:

- Auth state drives routing (not URL-based routing)
- Loading state prevents premature routing decisions
- Profile loading completes before routing resolves (prevents ProfileSetup flicker)
- Clean state reset on sign-out (profile, games, activeGame all cleared)

#### Finding [INFO]: No deep-link preservation

When a user arrives at the app and isn't authenticated, they're always routed to `landing`. Any deep-link context (e.g., a game ID from a shared link) would be lost. This is a UX issue, not a security issue.

---

### 9. App Check Configuration

**File:** `src/firebase.ts:48-70`

#### What's done right:

- reCAPTCHA v3 App Check in production (prevents bot API abuse)
- Debug token in dev mode for local development
- Production alert via Sentry if App Check is disabled (missing env var)

#### Finding [MEDIUM]: App Check is optional (env-var gated)

If `VITE_RECAPTCHA_SITE_KEY` is not set, App Check is silently disabled. The production warning is a console.error + Sentry message, but the app continues to function without protection.

**Risk:** If the env var is accidentally removed during a deploy, the app runs without bot protection. Firebase APIs would be callable by any HTTP client with the Firebase config (which is public in the client bundle).

**Recommendation:** Consider making App Check mandatory in production by throwing an error or showing a maintenance page when it's missing, rather than just logging.

---

### 10. Input Validation

#### What's done right:

- Email validated client-side with `EMAIL_RE` + server-side by Firebase Auth
- Username: `[a-z0-9_]+`, 3-20 chars, enforced both client-side and in Firestore rules
- Password: 6+ chars minimum (Firebase default) + strength indicator
- Video URL validation: `isFirebaseStorageUrl()` checks protocol + hostname before rendering in `<video>` tags

#### Finding [LOW]: `EMAIL_RE` is permissive

```typescript
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

This accepts strings like `a@b.c` which are technically valid but unusual. Firebase Auth will reject truly invalid emails server-side, so this is just a UX concern.

**Verdict:** Acceptable — the server-side validation is the real gate.

---

## Summary Table

| #   | Finding                                                   | Severity | Status                                                          |
| --- | --------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| 1   | No nonce on Google OAuth provider                         | Medium   | Mitigated by Firebase state param                               |
| 2   | No explicit `auth/too-many-requests` error handling       | Medium   | **FIXED**                                                       |
| 3   | ~1hr token revocation window                              | Medium   | Firebase Auth limitation                                        |
| 4   | User profiles expose email to all authenticated users     | Medium   | **FIXED** — email removed from Firestore                        |
| 5   | `script-src 'unsafe-inline'` in CSP                       | Medium   | **FIXED** — inline script externalized, `unsafe-inline` removed |
| 6   | App Check is optional in production                       | Medium   | Bot protection can silently disable                             |
| 7   | Any auth'd user can read/upload storage files             | Medium   | Accepted risk (documented)                                      |
| 8   | No `auth/too-many-requests` UX feedback                   | Medium   | **FIXED** (same as #2)                                          |
| 9   | Password strength indicator doesn't block weak passwords  | Low      | Firebase enforces 6-char minimum                                |
| 10  | Game delete rule is broad                                 | Low      | Acceptable for MVP                                              |
| 11  | Firestore cleanup failure after auth deletion not alerted | Low      | **FIXED** — Sentry alert added                                  |
| 12  | E2E test auth exposure (dev-only)                         | Low      | Tree-shaken from production                                     |
| 13  | `EMAIL_RE` is permissive                                  | Low      | Server-side validation catches it                               |
| 14  | No `frame-ancestors` in CSP                               | Info     | **FIXED** — `frame-ancestors 'none'` added                      |
| 15  | No deep-link preservation on auth redirect                | Info     | UX, not security                                                |

---

## Fixes Applied in This PR

The following production hardening changes were implemented and verified (459/459 tests passing, zero type errors, zero lint errors):

### 1. Rate-limit and network error handling (`AuthScreen.tsx`)

- Added explicit `auth/too-many-requests` error: "Too many attempts. Please wait a few minutes and try again."
- Added explicit `auth/network-request-failed` error: "Network error — check your connection and try again."
- Both errors now shown for email/password AND Google OAuth sign-in flows.

### 2. PII reduction — email removed from Firestore (`users.ts`, `ProfileSetup.tsx`)

- `createProfile()` no longer writes `email` to Firestore `users/{uid}` documents.
- `UserProfile.email` made optional for backwards compatibility with existing profiles.
- Firebase Auth remains the source of truth for user email (never stored in Firestore).
- Eliminates PII leakage via the `allow read: if isSignedIn()` Firestore rule.

### 3. CSP hardened (`vercel.json`, `index.html`)

- Inline service worker cleanup script moved to external `public/sw-cleanup.js`.
- Removed `'unsafe-inline'` from `script-src` directive.
- Added `frame-ancestors 'none'` (CSP-native complement to `X-Frame-Options: DENY`).
- Added `https://www.google.com` and `https://recaptcha.google.com` to `frame-src` for App Check reCAPTCHA v3.

### 4. Orphaned data alerting (`GameContext.tsx`)

- `deleteUserData()` failure after successful auth deletion now:
  - Logs error with uid + username for ops debugging
  - Fires `captureException` to Sentry with full context
  - Does NOT throw — the user's auth account is already deleted, so we proceed gracefully.

### 5. Google OAuth rate-limit handling (`GameContext.tsx`)

- Added `auth/too-many-requests` case to `handleGoogleSignIn` error handler.
- Surfaces user-friendly rate-limit message and navigates to auth screen.

---

## What's Notably Absent (Good)

These common vulnerabilities are **not present** thanks to architectural decisions:

- **No CSRF risk** — no cookies used for auth, no custom backend forms
- **No SQL/NoSQL injection** — Firestore SDK parameterizes all queries
- **No server-side code execution** — no backend to exploit
- **No session fixation** — `select_account` prompt + Firebase's state parameter
- **No open redirect** — `isFirebaseStorageUrl()` validates all external URLs
- **No credential storage** — Firebase Auth handles all password storage
- **No CORS misconfiguration** — no custom API to misconfigure
- **No insecure deserialization** — no server-side object handling

---

## Remaining Recommendations (not addressed in this PR)

1. **Consider making App Check mandatory** in production builds (finding #6)
2. **Add nonce to Google OAuth provider** for defense-in-depth (finding #1)
3. **Consider restricting game delete** to non-active games (finding #10)

---

_This audit covers the auth system as of commit on the `claude/audit-auth-google-oauth-ifVDy` branch. It does not cover network-level security (TLS configuration, DNS, CDN), Firebase Console settings (authorized domains, OAuth consent screen), or Google Cloud IAM permissions._
