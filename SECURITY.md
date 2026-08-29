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

- Profile **writes** are owner-only, and username and UID are immutable after creation. Reads are split by verb: `get` on `users/{uid}` is public (a shared `/player/{uid}` link must resolve for a signed-out visitor), while `list` requires sign-in so an anonymous client cannot enumerate every account.
- Username reservation is atomic — a Firestore transaction prevents two users from claiming the same handle in a race condition.
- Only the current-turn player can update a game. Player UIDs are immutable once a game is created.
- Scores can only increase, never decrease, and only one player gains a letter per update.
- Game status transitions are validated: `active → complete` requires a player reaching 5 letters; `active → forfeit` requires the current player's turn to have expired.
- Only the two players **and the nominated referee** can read a game (`isParticipant` = `isPlayer(game) || isJudge(game)`).
- Game creation is rate-limited to one per 30 s per user, and turn writes to one per 2 s, both anchored on server-pinned timestamps.

### Storage Security Rules

Firebase Storage rules (`storage.rules`) enforce:

- Only authenticated users can upload or download videos.
- Video size: minimum 1 KB (prevents stub uploads), maximum 50 MB.
- Content type: must be `video/webm` (web) or `video/mp4` (native/Capacitor).
- Filename: pinned by exact-string equality to `set-{uid}.{ext}` or `match-{uid}.{ext}`, where `{uid}` is `request.auth.uid`. Exact equality (not a regex) inherently rejects path traversal and encoded separators. The **uid suffix** is the load-bearing part: without it, an attacker who learned a `gameId` could pre-create the victim's next upload path, and because `update` is denied the victim's own upload would collide, be evaluated as an update, be rejected, and they would forfeit on the turn timer.
- The extension and the `Content-Type` must agree, so a client cannot ship mp4 bytes behind a `.webm` name.
- The uploader's UID is bound into `customMetadata.uploaderUid` at upload time. **`update` is never granted** on game videos — a committed object is append-only, because `clips/*` docs (immutable) reference its URL as the content-moderation audit trail. A retry must `delete` then `create`, which re-validates size, MIME, filename, and uploader from scratch. `delete` requires `resource.metadata.uploaderUid == request.auth.uid`.
- `read` and `delete` stay filename-agnostic so objects written under the pre-uid scheme (`set.webm` / `match.mp4`) remain playable and deletable by their uploader.

Two further upload surfaces are governed by the same rules file:

- **Avatars** — `users/{uid}/avatar.{webp|jpeg|png}`, owner-only create and delete, 1 KB – 2 MB, per-extension content-type pinning, `update: if false` so a prior moderation pass cannot be silently overwritten. Avatars are additionally screened on-device with nsfwjs before upload, and the Firestore rule pins `users/{uid}.profileImageUrl` to this bucket and the writer's UID so a malicious profile cannot point at someone else's avatar.
- **User-posted clips** — `userClips/{uid}/{clipId}.{webm|mp4}`, where the uid is the path prefix so ownership is structural. `update: if false`.

**Known limitation:** Storage rules cannot cross-reference Firestore — a cross-service `firestore.get()` only reaches the `(default)` database and this app uses the named database `"skatehubba"`. So game membership is not verified at the storage layer, and the `users/{uid}.banned` flag is not enforceable there either. The residual is bounded: an attacker can only create junk under their own uid-suffixed names (≤50 MB, auth-only readable, never referenced by any Firestore doc), and it is reaped by the 90-day retention sweep. The Firestore `clips` create rule is the real gate — without a clip doc the object is unreachable from the feed.

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
- **Client-side turn deadline**: Turn expiry (`turnDeadline`) is checked on the client when a game is opened. A malicious client could avoid triggering the forfeit by not opening the game. The integrity of the deadline is enforced when the forfeit is submitted — Firestore rules validate that the winning player is the opponent of the current-turn player.

---

## CI Pipeline & Branch Protection

The `main` branch is protected by GitHub branch protection rules and automated CI guards. These were introduced after unsupervised AI agents pushed unauthorized changes (rewritten game logic, unapproved Cloud Functions) directly to `main`.

Key safeguards:

- **All changes to `main` must go through a pull request** with at least one CODEOWNER approval
- **Required CI checks** must pass: lint, type check, tests, build
- **Cloud Functions guard**: a CI job rejects PRs that introduce new Cloud Functions code
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
- Sustained challenge spam beyond the rules-enforced cooldowns (30 s per game creation, 2 s per turn write, 1 h per report, 5 s per notification). Per-pair blocking is available to users; a global reputation system is not in scope.
- Enumeration of usernames — all authenticated users can query the `usernames` collection by design (needed for opponent lookup)
- Vercel preview deployments indexed by search engines — `noindex` headers are set for non-production hosts
