# Security Policy

## Supported Versions

| Version         | Supported |
| --------------- | --------- |
| Latest (`main`) | Yes       |
| Older branches  | No        |

We only maintain the latest version on `main`. Security patches are applied there and deployed to production.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability:

1. Email **security@skatehubba.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fix (optional)

2. We will acknowledge receipt within **48 hours** and aim to provide a fix or mitigation within **7 days** for critical issues.

3. We'll credit you in the release notes if you'd like.

---

## Security Architecture

Understanding how the app is built helps clarify what the attack surface looks like.

### No Custom Backend

There is no Express server and no general-purpose API. The client (React SPA) talks directly to Firebase services, which eliminates a large class of server-side vulnerabilities (injection, RCE, SSRF, etc.) at the architecture level. Server-side code is limited to the maintainer-approved stats close-out Cloud Function (`functions/src/`, pinned to an exact file set by the `verify-no-cloud-functions` CI gate) and the narrow serverless endpoints under `api/` — scheduled sweeps for expired turns and disputes, the FCM push drain (`api/cron/drain-push-dispatch.ts`, which replaced a `firestore-send-fcm` Firebase Extension that turned out not to exist — see `docs/CHARTER.md` §4.4), account deletion, and social-card metadata.

Push delivery introduces one deliberate privacy trade-off documented inline at `src/services/pushDispatch.ts`: FCM registration tokens are mirrored to `/pushTargets/{uid}`, which is readable by any signed-in user so a sender can embed the recipient's tokens in the dispatch doc the drain endpoint consumes. The trade-off is bounded — FCM tokens alone cannot be abused without server credentials, the `/push_dispatch` create rule restricts senders to game participants, and a per-dispatch 5s cooldown is anchored by a companion `/push_dispatch_limits` write that must commit atomically in the same `writeBatch`. Caps of 10 tokens per user (rules-enforced) and 10 tokens per dispatch (`MAX_TOKENS_PER_DISPATCH`) keep worst-case fan-out bounded.

### Firestore Security Rules as the Authorization Layer

All access control is enforced by Firestore security rules (`firestore.rules`), not by client-side code. Key guarantees:

- Users can only read/write their own profile. Username and UID are immutable after creation.
- Username reservation is atomic — a Firestore transaction prevents two users from claiming the same handle in a race condition.
- Only the current-turn player can update a game. Player UIDs are immutable once a game is created.
- Scores can only increase, never decrease, and only one player gains a letter per update.
- Game status transitions are validated: `active → complete` requires a player reaching 5 letters; `active → forfeit` requires the current player's turn to have expired.
- Only the two players in a game can read it.

### Storage Security Rules

Firebase Storage rules (`storage.rules`) enforce:

- Only authenticated users can upload or download videos.
- Video size: minimum 1 KB (prevents stub uploads), maximum 50 MB.
- Content type: must be `video/webm` (web) or `video/mp4` (native/Capacitor).
- Filename: only `set.webm`, `set.mp4`, `match.webm`, or `match.mp4` are accepted — this prevents path traversal via crafted filenames.
- The uploader's UID is bound into `customMetadata.uploaderUid` at upload time. Update and delete writes require `resource.metadata.uploaderUid == request.auth.uid`, so signed-in users cannot overwrite or delete each other's videos.

### XSS Prevention

Video URLs stored in Firestore are rendered in `<video>` tags. Before use, URLs are validated with `isFirebaseStorageUrl()` — only Firebase Storage URLs on the project's bucket are accepted. This prevents a compromised Firestore document from injecting arbitrary URLs.

### Authentication

- Email/password authentication requires email verification before gameplay is enabled.
- Google OAuth uses popup (with redirect fallback for mobile/Safari). The `select_account` prompt is always shown to prevent silent session fixation.
- Firebase Auth tokens expire and are automatically refreshed by the SDK. Revocation propagates within the token refresh window (~1 hour).

### Client-Side Code Is Not Trusted

The Firestore security rules treat the client as untrusted. Any attempt to manipulate game state from the browser (e.g., directly writing to Firestore with a modified score) will be rejected by the rules. The client code is therefore not the security boundary — the rules are.

---

## Known Limitations / Design Decisions

- **Self-judging**: Players report whether they landed a trick. There is no server-side video analysis. This is an honor-system game.
- **Storage rules cannot cross-reference Firestore**: Firebase Storage rules can't verify that the uploading user is a player in the game. They rely on the Firestore rules to enforce game membership. An authenticated user who knows a `gameId` could upload to that game's storage path, though they could not write the resulting URL into Firestore without being a player in the game.
- **Turn deadline enforcement**: `turnDeadline` is checked on the client when a game is opened, *and* swept server-side. `api/cron/sweep-expired-turns.ts` runs every 15 minutes (`.github/workflows/sweep-expired-turns.yml`), re-reads each expired game in an Admin-SDK transaction, and applies the same transition the client would via the shared `decideExpiredForfeit` helper — so the two paths cannot diverge. Declining to open the app no longer avoids a forfeit; it delays it by at most one sweep. Firestore rules independently validate that the winner is the opponent of the current-turn player. (GitHub Actions `schedule` is best-effort, so the sweep can run late under platform load.)

---

## CI Pipeline & Branch Protection

The `main` branch is protected by GitHub branch protection rules and automated CI guards. These were introduced after unsupervised AI agents pushed unauthorized changes (rewritten game logic, unapproved Cloud Functions) directly to `main`.

Key safeguards:

- **All changes to `main` must go through a pull request** with at least one CODEOWNER approval
- **Required CI checks** must pass: lint, type check, tests, build
- **Cloud Functions allowlist guard**: a CI job permits only the four maintainer-approved files under `functions/src/` (the stats close-out, approved 2026-07) and rejects any other addition there
- **Workflow change detection**: modifications to `.github/workflows/` are flagged for manual review
- **Force pushes and branch deletion are blocked** on `main`

Full configuration details: [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md)

---

## Future Hardening

These are low-priority improvements identified during the auth security audit (March 2026). None are vulnerabilities — they are defense-in-depth opportunities:

- **Make App Check mandatory in production** — currently double-gated by `VITE_APPCHECK_ENABLED` and `VITE_RECAPTCHA_SITE_KEY`. The opt-in default exists because a Firebase Console enforcement toggle without a matching reCAPTCHA allowlist locks every signed-in user out (see `docs/PERMISSION_DENIED_RUNBOOK.md`). Re-enabling is gated on App Check verified-request rate > 95 % for the production domains.
- **Add nonce to Google OAuth provider** — Firebase's state parameter already prevents CSRF, but a nonce would add an extra replay-protection layer.
- Game deletion is now restricted to non-active games (`firestore.rules`: `resource.data.status != "active"`).

---

## Out of Scope

The following are not considered security vulnerabilities for this project:

- Self-judging cheating (a player lying about landing a trick) — this is a design decision
- Enumeration of usernames — all authenticated users can query the `usernames` collection by design (needed for opponent lookup)
- Vercel preview deployments indexed by search engines — `noindex` headers are set for non-production hosts

> **Note — game-creation abuse is no longer out of scope; it is enforced.**
> `firestore.rules:1162` applies a 30-second per-user cooldown on game creation,
> anchored to `request.time` so a client cannot back-date the marker. Ten
> distinct limiters run across the rules — game create, spot create, user-clip
> create, per-turn actions (2s), notifications, push dispatch, reports (1/hr)
> and nudges (1/hr). `rules-tests/rate-limit-bypass-redteam.rules.test.ts`
> covers the anti-bypass hardening in 24 tests.
