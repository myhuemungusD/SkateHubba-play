# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

**Judge system (optional dispute resolution)**

- Challenge screen now has an optional "Add a judge?" friend picker — nominate a third player who rules on disputes and "Call BS" claims.
- Nominated judges receive a notification and can accept or decline the invite from inside the game screen.
- While the invite is pending (or declined), the game operates on the honor system — no disputes or BS calls.
- Once the judge accepts, two new paths unlock:
  - **Dispute**: When the matcher claims "landed," the judge reviews both videos and rules landed or missed. Judge (never the setter) has 24 h; after that, the matcher's call auto-accepts.
  - **Call BS on setter**: Before attempting, the matcher can send the setter's video to the judge. Judge rules clean (matcher must attempt) or sketchy (setter re-sets). 24 h timeout → set stands (benefit of the doubt to the setter).
- Both players see a "Judge Pending / Judge / No Judge" badge on the game screen so they always know which resolution path is live.
- Judges appear in their own game list and see a neutral "Judge's Call" / "Call BS Review" UI — they never record, never hold a letter.

### Changed

- Honor-system (no judge) games skip the `disputable` phase entirely. A claimed-landed attempt now swaps roles immediately; a claimed-missed attempt applies a letter immediately. The 24 h review window no longer sits in the middle of every turn when there's no judge to arbitrate.
- Dispute resolution is now judge-only. The setter never self-judges — that was the point of inviting a neutral third party. Existing games without a judge continue to run on the honor system.

### Schema

- `GameDoc` gains `judgeId: string | null`, `judgeUsername: string | null`, `judgeStatus: 'pending' | 'accepted' | 'declined' | null`, `judgeReviewFor: string | null`.
- New `GamePhase` value: `setReview` (judge reviewing a "Call BS" on the set trick).
- `TurnRecord.judgedBy` records the judge UID when a turn was judged (null otherwise).
- Firestore security rules validate judge immutability, judge-only dispute paths, and participant-scoped reads (player or judge).

---

## [1.0.0] — 2024-12-01

Initial production release of the SkateHubba S.K.A.T.E. async trick battle game.

### Added

**Authentication**

- Email/password sign-up with automatic verification email
- Email/password sign-in (requires verified email)
- Google OAuth sign-in via popup, with automatic redirect fallback for browsers that block popups (mobile, Safari)
- Password reset via email link
- Resend verification email from within the app
- Email verification banner shown to unverified users

**User Profiles**

- Unique username reservation using a Firestore transaction (prevents race conditions)
- Username validation: 3–20 characters, lowercase alphanumeric and underscore only
- Skateboarding stance selection: Regular or Goofy
- Profile created atomically with username reservation on first login

**Game Loop**

- Challenge any player by username
- Setting phase: name your trick and record a one-take video
- Matching phase: watch the setter's video and record your attempt
- Self-judging: report whether you landed or missed
- Scoring: a missed trick earns the matcher one S.K.A.T.E. letter
- Win condition: first player to accumulate 5 letters (S-K-A-T-E) loses
- Rematch option after game completion

**Real-Time Updates**

- Both players see game state changes the moment they occur via Firestore `onSnapshot` listeners
- Lobby shows all active and completed games, sorted by activity

**Turn Timer**

- 24-hour deadline per turn
- Deadline is reset to 24 hours from the current time on each turn transition
- Expired turns are automatically forfeited when a player opens the game

**Video Recording**

- In-browser one-take recording using the MediaRecorder API (WebM format)
- Upload to Firebase Storage with size validation (1 KB – 50 MB)
- Video playback in-app for the matching player

**Security**

- Firestore security rules enforce all game logic server-side
- Storage rules enforce authentication, file size limits, content type, and filename allowlist
- Firebase Storage URL validation before rendering any video element
- No custom backend — attack surface limited to Firebase and Vercel

**Infrastructure**

- Vercel hosting with SPA routing (`index.html` fallback)
- Vercel Analytics for page view tracking
- GitHub Actions CI: type check → test → build on every push to `main` and on PRs
- Progressive Web App manifest (installable on iOS and Android)
- Offline read support via Firestore `persistentLocalCache`
- Dark theme with custom brand tokens (orange, green, red, dark surfaces)

---

[Unreleased]: https://github.com/myhuemungusD/skatehubba-play/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/myhuemungusD/skatehubba-play/releases/tag/v1.0.0
