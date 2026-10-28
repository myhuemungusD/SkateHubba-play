# Public clip moderation

> **Scope correction (2026-10-26):** `runUploadModeration()` screens only `source: "user"`. Automatically published game clips are not covered by that upload filter. Validate report/removal handling for game/dispute clips separately. `config/moderation.enabled` is the third required control; storage still permits owner creates under `approvedClips/`, so Firestore gating and token/URL handling must be tested together.

Three checks on clips people post to the feed (`clips` where `source` is `user`, videos under `userClips/`).

1. **On upload.** A new public clip starts as `moderation: pending` and stays out of the feed. The owner sees "Checking…". `moderateNewClip` asks the Cloud Video Intelligence API for explicit content and for labels. A clear explicit hit becomes `rejected`. A borderline hit, or no skateboard / skateboarding label, becomes `review`. Anything else becomes `approved` and shows up in the feed. Thresholds live in `functions/src/moderation/config.ts`.
2. **From reports.** Reasons `not_skating` and `inappropriate` (and the older `non_skate_content` and `inappropriate_video`) count. When 3 different people, each with an account older than a day, report the same public clip, `moderateClipReport` hides it as `review`. The owner cannot report their own clip. Game and dispute clips are not auto-hidden. A "not skating" report on those still lands in the existing reports queue.
3. **An admin.** `/admin` → Clips. Keep puts it back in the feed. Remove hides it, tells the owner why, and links to an appeal.

If Video Intelligence errors or times out, the clip goes to `review`. It is never approved on a failure. The failure is sent to Sentry when `SENTRY_DSN` is set.

## What is off until you turn it on

Three controls must agree: the client build flag, the Functions parameter, and the Firestore rules configuration. Store workflows already set the client flag to true; deployed server state is not proved by this file.

| Switch                                 | Where                             | Default | What it does                                                                                                                                                               |
| -------------------------------------- | --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FEATURE_CLIP_MODERATION_ENABLED` | Vercel env, inlined at build time | unset   | New public clips are written `pending` and hidden from the feed. Anything except the literal `true` keeps today's behavior: the clip is `active` immediately.              |
| `MODERATION_ENABLED`                   | Cloud Functions param             | `false` | When false, `moderateNewClip` and `moderateClipReport` leave the clip alone. `decideClipModeration` still works, so a review queue can be cleared after the switch is off. |

Deploy the functions with the comment-report filter (`handleClipReport` ignores reports that carry a `commentId`) before anyone sets `MODERATION_ENABLED=true`. Otherwise reports on a comment would count toward hiding the clip it sits under.

Turn the client flag on only after the function is deployed and `MODERATION_ENABLED` is true. If the client flag is on and the function is not deployed, new public clips stay `pending` and hidden. That is the fail-safe. Do not treat the old default-off instructions as current store settings. Verify the deployed server controls before shipping.

`SENTRY_DSN` is a functions param (default empty). An empty value skips the alert. A thrown Sentry call still sends the clip to review.

## Appeals

A rejection or a removal writes `moderationStatements/clip_{clipId}` with `action: content_restricted`. Settings lists that statement under Reports & actions. The owner appeals there, which files `appeals/statement_clip_{clipId}`. The notification opens `/settings#safety-reports`.

The owner's "Checking…" strip is `OwnClipModeration`, floating over the full-screen feed. It stays hidden until the client flag is on.

## Deploy

Merging to `main` deploys Firestore rules and indexes only. It does not deploy functions and it does not enable the API.

Use Actions → **Deploy Firebase Functions** on `main`. Set `functions` to `moderateNewClip,moderateClipReport,decideClipModeration` and `confirm` to `deploy`. See `docs/DEPLOY_FUNCTIONS.md`.

1. In Google Cloud project `sk8hub-d7806`, enable the **Cloud Video Intelligence API**.
2. Deploy the three functions to testers first:

```bash
firebase use sk8hub-d7806
firebase deploy --only functions:moderateNewClip,functions:moderateClipReport,functions:decideClipModeration
```

3. On that deploy, set `MODERATION_ENABLED=true` and `SENTRY_DSN` to the project DSN. `defineBoolean` / `defineString` prompt for these, or read them from `functions/.env.sk8hub-d7806` (not committed).
4. Set `config/moderation.enabled=true` in the named `skatehubba` database once the Functions deployment is ready. `moderationOn()` in firestore.rules uses this document to reject direct active user-clip creation.
5. Test a safe upload, a rejected upload and an API failure with the client flag enabled. Confirm pending clips are private, decisions appear, and the admin queue can resolve review cases. Both native store workflows already enable the client flag.

App Check on `decideClipModeration` is monitor-only (`enforceAppCheck: false`), matching `docs/APPCHECK_ROLLOUT.md`.

## Cost

Video Intelligence bills stored video by the minute, and a partial minute rounds up. The first 1,000 minutes per month are free **per feature**. After that, label detection is $0.10 per minute and explicit content detection is $0.10 per minute.

A clip under a minute uses one billed minute of each feature, so it is about **$0.20** once the free tier is used up.

Pricing: https://cloud.google.com/video-intelligence/pricing
