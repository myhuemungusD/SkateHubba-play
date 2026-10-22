# Pro blessing

**Rule:** only real pros have pro accounts. A pro badge or pro profile can never be earned, won, bought or levelled into. XP, achievements, badges, locker items and awards never touch `isVerifiedPro`. The only ways in:

1. **Blessing (normal path).** An existing verified pro blesses a skater from their profile ("Bless as pro"). The skater accepts and turns pro.
2. **Founder seeding (admin).** The admin "Seed Pro" tab grants the first pros and revokes. Every grant is stamped with the admin's uid.

## Why it works this way

Benchmarked against invite-only systems: Dribbble invites (a limited invite budget keeps the bar high), early Clubhouse (an inviter is shown on your profile forever), Lobsters (public invite tree, so a bad invite reflects on the inviter) and skate culture's "turned pro" moment, where a team or an established pro vouches for you.

- **Server-enforced.** The `proBlessing` callable is the only non-admin writer of `isVerifiedPro`, `verifiedBy` and `verifiedAt`. Firestore rules deny every client write to those fields, admins included, and to `/proBlessings`. Admin seeding is the `proSeed` callable (reason + evidence, append-only `proAudit` row).
- **Caller must be a verified, unbanned pro with a verified email.** No self-blessing. The target can't already be pro, banned, or have blocked the blesser.
- **Account age.** The target's account must be at least `PRO_BLESSING_MIN_ACCOUNT_DAYS` days old (default 30). This stops a pro from minting fresh accounts.
- **Rate limit.** `PRO_BLESSING_LIMIT` blessings per pro per `PRO_BLESSING_WINDOW_DAYS` days (defaults: 2 per 30). Declined offers still count, so a pro can't spam offers.
- **Reason required** (10–280 characters). It is shown on the new pro's profile, so the blesser stakes their name on it.
- **Acceptance required.** Pro status is public and permanent, so the skater has to say yes. The offer lapses after 14 days. Only one open offer per skater at a time.
- **Lineage is immutable.** Each `proBlessings/{id}` record keeps blesser, target, reason and timestamps, and is never deleted. Accepted records are public ("Blessed by @X" plus the chain above them). Pending and declined offers are visible only to the two skaters and admins.
- **Revoke (admin claim only).** `{ action: "revoke", targetUid, reason }` clears pro, stamps the admin, and marks the record `revoked` with who and why. The record stays.

## Data

`proBlessings/{autoId}`: `blesserUid`, `blesserUsername`, `targetUid`, `targetUsername`, `reason`, `status` (`pending` → `accepted` | `declined` | `expired`; `accepted` → `revoked`), `createdAt`, `respondedAt?`, `revokedAt?`, `revokedBy?`, `revokeReason?`.

Accept writes `users/{uid}` `{ isVerifiedPro: true, verifiedBy: <blesserUid>, verifiedAt }`. Notifications `pro_blessing` (to the skater) and `pro_blessing_accepted` (to the blesser) are written by the Admin SDK.

## Switches (all default off)

| Where    | Name                                                                              | Effect                                                                                    |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Function | `PRO_BLESSING_ENABLED`                                                            | `true` opens bless/accept/decline to everyone.                                            |
| Function | `PRO_BLESSING_TESTER_UIDS`                                                        | Comma-separated uids allowed while off (same pattern as `DICE_TESTER_UIDS`).              |
| Function | `PRO_BLESSING_LIMIT`, `PRO_BLESSING_WINDOW_DAYS`, `PRO_BLESSING_MIN_ACCOUNT_DAYS` | Tuning. Defaults 2 / 30 / 30.                                                             |
| Web      | `VITE_FEATURE_PRO_BLESSING`                                                       | Shows "Bless as pro", "Blessed by", the turned-pro screen and the live hero on Pro tools. |

All params have defaults, so `FUNCTIONS_DOTENV` doesn't need new lines to deploy.

## Deploy

`proBlessing` is a new function. It has to be created once as a stub with `--build-service-account sk8hub-d7806@appspot.gserviceaccount.com` before the normal workflow can update it (see docs/DEPLOY_FUNCTIONS.md). Then run `gh workflow run firebase-functions-deploy.yml -R myhuemungusD/SkateHubba-play --ref main -f confirm=deploy`.
