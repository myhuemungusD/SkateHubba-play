# Public clip moderation

Three checks on clips people post to the feed (`clips` where `source` is `user`, videos under `userClips/`).

1. **On upload.** A new public clip starts as `moderation: pending` and stays out of the feed. The owner sees "Checking…". `moderateNewClip` asks the Cloud Video Intelligence API for explicit content and for labels. A clear explicit hit becomes `rejected`. A borderline hit, or no skateboard / skateboarding label, becomes `review`. Anything else becomes `approved` and shows up in the feed. Thresholds live in `functions/src/moderation/config.ts`.
2. **From reports.** Reasons `not_skating` and `inappropriate` (and the older `non_skate_content` and `inappropriate_video`) count. When 3 different people, each with an account older than a day, report the same public clip, `moderateClipReport` hides it as `review`. The owner cannot report their own clip. Game and dispute clips are not auto-hidden. A "not skating" report on those still lands in the existing reports queue.
3. **An admin.** `/admin` → Clips. Keep puts it back in the feed. Remove hides it, tells the owner why, and links to an appeal.

If Video Intelligence errors or times out, the clip goes to `review`. It is never approved on a failure. The failure is sent to Sentry when `SENTRY_DSN` is set.

## What is off until you turn it on

Two switches, and both start off.

| Switch                                 | Where                             | Default | What it does                                                                                                                                                               |
| -------------------------------------- | --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FEATURE_CLIP_MODERATION_ENABLED` | Vercel env, inlined at build time | unset   | New public clips are written `pending` and hidden from the feed. Anything except the literal `true` keeps today's behavior: the clip is `active` immediately.              |
| `MODERATION_ENABLED`                   | Cloud Functions param             | `false` | When false, `moderateNewClip` and `moderateClipReport` leave the clip alone. `decideClipModeration` still works, so a review queue can be cleared after the switch is off. |

Turn the client flag on only after the function is deployed and `MODERATION_ENABLED` is true. If the client flag is on and the function is not deployed, new public clips stay `pending` and hidden. That is the fail-safe. Leave the production client flag unset.

`SENTRY_DSN` is a functions param (default empty). An empty value skips the alert. A thrown Sentry call still sends the clip to review.

## Appeals

A rejection or a removal writes `moderationStatements/clip_{clipId}` with `action: content_restricted`. Settings lists that statement under Reports & actions. The owner appeals there, which files `appeals/statement_clip_{clipId}`. The notification opens `/settings#safety-reports`.

The Shorts-style feed pull request (#641) had not merged. The owner's "Checking…" strip is `OwnClipModeration` inside the current feed. Keep that mount if the feed file conflicts.

## Deploy (do this by hand)

Merging to `main` deploys Firestore rules and indexes only. It does not deploy functions and it does not enable the API. Do not deploy this from CI.

1. In Google Cloud project `sk8hub-d7806`, enable the **Cloud Video Intelligence API**.
2. Deploy the three functions to testers first:

```bash
firebase use sk8hub-d7806
firebase deploy --only functions:moderateNewClip,functions:moderateClipReport,functions:decideClipModeration
```

3. On that deploy, set `MODERATION_ENABLED=true` and `SENTRY_DSN` to the project DSN. `defineBoolean` / `defineString` prompt for these, or read them from `functions/.env.sk8hub-d7806` (not committed).
4. Build a **preview** with `VITE_FEATURE_CLIP_MODERATION_ENABLED=true`. Leave production on the default (flag unset) until testers have looked at a few clips.

App Check on `decideClipModeration` is monitor-only (`enforceAppCheck: false`), matching `docs/APPCHECK_ROLLOUT.md`.

## Cost

Video Intelligence bills stored video by the minute, and a partial minute rounds up. The first 1,000 minutes per month are free **per feature**. After that, label detection is $0.10 per minute and explicit content detection is $0.10 per minute.

A clip under a minute uses one billed minute of each feature, so it is about **$0.20** once the free tier is used up.

Pricing: https://cloud.google.com/video-intelligence/pricing
