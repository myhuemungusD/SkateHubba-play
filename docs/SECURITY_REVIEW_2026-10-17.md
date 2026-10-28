# Security review — 2026-10-17

> **Current release review: 2026-10-26.** See [STORE_READINESS_2026-10-26.md](STORE_READINESS_2026-10-26.md) for source-verified store gates and validation limits. Status claims below belong to their stated audit dates; they do not prove current deployments, console settings or signed builds.

Scope: Firestore/Storage rules, Cloud Functions, Vercel API, auth, secrets,
dependencies, web headers, Capacitor native config. Benchmarked against
OWASP ASVS 4 / MASVS 2.

## Fixed in this PR

- **pushTargets list (MASVS-PRIVACY / ASVS V4.2):** any signed-in user could
  `list` the whole collection and dump every user's FCM device tokens. Now
  `get` only (a sender still looks up a known recipient). Rules test added.
- **Android backup (MASVS-STORAGE-2):** `allowBackup="true"` let adb/cloud
  backups copy the WebView's stored Firebase session. Now off.
- **functions deps:** `uuid` (moderate, via gaxios) fixed by `npm audit fix`.

## Open (not fixed here)

- **Closet Studio shared designs (medium):** `moderation: "passed"` is set by
  the client after an on-device filter, so a modified client can share an
  unscreened image. Needs a server screener (Storage trigger + SafeSearch)
  before Closet Studio goes public. Tester-only today.
- **pushTargets get (low):** still readable one uid at a time, needed by
  TestFlight build 10. After the next build, move token lookup into
  pushDispatchOnCreate and make pushTargets owner-only.
- **App Check (low):** diceAction, proBlessing, decideClipModeration and
  Firestore run App Check in monitor mode (docs/APPCHECK_ROLLOUT.md).
- **WTT cron stubs (info):** /api/cron/build-wtt-items and wtt-nightly-em have
  no CRON_SECRET check. They are inert stubs; add the bearer check when built.
- **Owner-update denylist (info):** users/{uid} owner updates use a denylist of
  server fields. Every new server-written field (e.g. map check-in XP) must be
  added to it and to the create zero-seed list.

## Checked and OK

Admin is claim-only (`token.admin`); pros never get admin (blessing sets only
isVerifiedPro). config/featureTesters only flips client UI flags; server gates
use deploy-time tester lists. XP, stats, Bucks wallet/ledger, serials, locker,
drops, trades are server-only. Closet callables enforce auth + App Check,
idempotent ledger ids, daily caps; IAP is a refuse-all stub. Account deletion
verifies a fresh, non-revoked ID token. Cron endpoints use constant-time
CRON_SECRET checks. Profile links are host-allowlisted; no innerHTML of user
data. CSP/HSTS/XFO/nosniff/COOP set. Deep links are host/route validated.
Uploads are size/type/path pinned. gitleaks: only test fixtures; no .env with
secrets ever committed. npm audit: root 0, functions 0 after fix.
