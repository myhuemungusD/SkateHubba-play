# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older branches | No |

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

There is no Express server, no REST API, no serverless functions. The client (React SPA) talks directly to Firebase services. This eliminates a large class of server-side vulnerabilities (injection, RCE, SSRF, etc.) at the architecture level.

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
- Content type: must be `video/webm`.
- Filename: only `set.webm` or `match.webm` are accepted — this prevents path traversal via crafted filenames.

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

## Out of Scope

The following are not considered security vulnerabilities for this project:

- Self-judging cheating (a player lying about landing a trick) — this is a design decision
- Abuse of the game creation system (challenging the same person repeatedly) — rate limiting is not implemented in the MVP
- Enumeration of usernames — all authenticated users can query the `usernames` collection by design (needed for opponent lookup)
- Vercel preview deployments indexed by search engines — `noindex` headers are set for non-production hosts
