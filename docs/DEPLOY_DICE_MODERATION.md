# Roll Dice & Clip Moderation Deployment Checklist

This document provides step-by-step deployment instructions for Roll Dice and Public Clip Moderation. Both features are built, tested, and ready to deploy.

**Important:** ALL flags stay **OFF**. Both `DICE_ENABLED` and `MODERATION_ENABLED` remain `false`. Features are deployed but inactive. Client flags (`VITE_FEATURE_*`) also stay unset in production.

---

**Testers:** the tester lists hold only Jason and Mike. `npm run testers:sync` keeps every server `*_TESTER_UIDS` list and `config/featureTesters` in step.

**Before testing a callable:** `diceAction` and `decideClipModeration` must answer a CORS preflight with `204`, not Google's bare `403`. If they answer `403`, the Cloud Run invoker grant is missing. See "Callables must be public at the Cloud Run layer" in [DEPLOYMENT.md](DEPLOYMENT.md#cloud-functions-deployment).

## Pre-Deployment Verification

### ✅ Roll Dice Ready

- ✅ All functions built: `diceAction`, `diceSweep`
- ✅ All tests passing (15 test files, 100% coverage)
- ✅ DICE.md documentation complete
- ✅ Firestore rules ready (read-only for clients)
- ✅ Client code behind `VITE_FEATURE_DICE_ENABLED` flag

### ✅ Clip Moderation Ready

- ✅ All functions built: `moderateNewClip`, `moderateClipReport`, `decideClipModeration`
- ✅ All tests passing (12 test files, 100% coverage)
- ✅ CLIP_MODERATION.md documentation complete
- ✅ Firestore rules ready
- ✅ Client code behind `VITE_FEATURE_CLIP_MODERATION_ENABLED` flag

---

## Roll Dice Deployment

### 1. Deploy Functions (Tester Mode)

```bash
cd functions
firebase use sk8hub-d7806
firebase deploy --only functions:diceAction,functions:diceSweep
```

When prompted for params:

```text
DICE_ENABLED=false
DICE_TESTER_UIDS=<uid1>,<uid2>,<uid3>
```

**Note:** Both players in a test game must be in `DICE_TESTER_UIDS`.

### 2. Deploy Preview

Set in Vercel preview environment:

```text
VITE_FEATURE_DICE_ENABLED=true
```

Rebuild the preview. Production remains unset.

### 3. Test

1. Sign in as a tester (uid in `DICE_TESTER_UIDS`)
2. Navigate to `/dice/new`
3. Challenge another tester
4. Play a full match
5. Verify turn timer (24h)
6. Let one game time out to verify `diceSweep`

### 4. Production Rollout (After Tester Approval)

1. Set `DICE_ENABLED=true` in Cloud Functions
2. Set `VITE_FEATURE_DICE_ENABLED=true` in Vercel Production
3. Redeploy both

---

## Clip Moderation Deployment

### 1. Enable Cloud Video Intelligence API

In Google Cloud Console for project `sk8hub-d7806`:

1. Navigate to **APIs & Services > Library**
2. Search for "Cloud Video Intelligence API"
3. Click **Enable**

**Cost:** First 1,000 minutes/month free. After that: $0.10/min for labels + $0.10/min for explicit content = ~$0.20 per <1min clip.

Pricing: https://cloud.google.com/video-intelligence/pricing

### 2. Deploy Functions (Tester Mode)

```bash
cd functions
firebase use sk8hub-d7806
firebase deploy --only functions:moderateNewClip,functions:moderateClipReport,functions:decideClipModeration
```

When prompted for params:

```text
MODERATION_ENABLED=false
SENTRY_DSN=<your_sentry_dsn>
```

### 3. Deploy Preview

Set in Vercel preview environment:

```text
VITE_FEATURE_CLIP_MODERATION_ENABLED=true
```

Rebuild the preview. Production remains unset.

### 4. Test

**Upload test:**

1. Sign in as a tester
2. Post a public clip
3. Verify "Checking…" appears
4. Wait for Video Intelligence (usually 10-30 seconds)
5. Check clip appears in feed with `moderation: approved`

**Report test:**

1. Have 3+ different users report the same clip
2. Verify clip becomes `moderation: review`
3. Go to `/admin` → Clips
4. Test Keep and Remove actions

**Edge cases:**

- Upload a non-skating video (should go to `review`)
- Upload inappropriate content (should go to `rejected`)
- Report own clip (should be ignored)

### 5. Production Rollout (After Tester Approval)

Set `VITE_FEATURE_CLIP_MODERATION_ENABLED=true` in Vercel Production and redeploy.

**Note:** `MODERATION_ENABLED` stays `false`. The functions remain in tester mode.

### 6. Rescreen clips stuck in pending

**When:** clips were posted while the client flag was on but the server
switch `MODERATION_ENABLED` was off. They stay `moderation: pending`
("Checking…") forever, because `moderateNewClip` only fires on create and
turning the switch on later does not revisit them. Run this once, right after
a deploy whose log prints `switch MODERATION: ON`.

**What it does:** `scripts/moderation/rescreen-pending.mjs` lists clips with
`moderation == "pending"` or `moderationStatus == "pending"`, oldest first,
and runs each pending user upload through `handleClipCreated`, the same
handler the trigger calls. Thresholds, notices, the clipsPosted badge and the
approved-path video copy all match a live screen. It is admin-only (no
callable, nothing in the client bundle) and runs from the
`moderation-rescreen.yml` GitHub Actions workflow, never from a laptop or the
team box.

**Safety:**

- Dry run by default. `mode=apply` needs `confirm=rescreen` and the `main`
  branch.
- **Moderation must be ON in production, or apply refuses.** The workflow's
  "Resolve moderation switch" step reads `MODERATION_ENABLED` exactly the way
  `firebase-functions-deploy.yml` does: a `MODERATION_ENABLED=` line in the
  `FUNCTIONS_DOTENV` secret wins, then the `MODERATION_ENABLED` repository
  variable (whitespace stripped, case-insensitive). Anything but `true`,
  including missing, stops apply with exit 2 before anything is installed or
  read; a dry run still runs. Only that one key is extracted, and only
  `true`/`false` is printed. The derived value is passed to the script, which
  refuses `--apply` again unless it is exactly `true`. Nothing hard-codes it.
- Each clip is re-read just before screening, and the handler's transaction
  re-checks `pending` at write time, so a decision by the live trigger or an
  admin is never overwritten. Re-running is safe.
- Clips newer than 10 minutes are left to the trigger.
- `limit` (default 1, max 50) and `delay_ms` (default 5000) pace Video
  Intelligence calls. Two screener errors in a row stop the run. A failed
  screen sends the clip to review, never approval.
- One run at a time (concurrency group `moderation-rescreen`).
- Clips with `moderationStatus: pending` but no `moderation: pending` are
  listed as `skipped-not-screenable` and left alone. See "Clips the
  rescreen cannot screen" below.

**Credentials:** no service-account key file, anywhere. The workflow signs in
with Workload Identity Federation as the deploy service account (the
`FIREBASE_WIF_PROVIDER` / `FIREBASE_WIF_SERVICE_ACCOUNT` pair from
`firebase-functions-deploy.yml`, `production` environment). The script uses
Application Default Credentials, which read the short-lived config the auth
step writes. There is no `FIREBASE_TOKEN` fallback; that token cannot sign
Admin SDK or Video Intelligence calls.

**Service account and APIs:** WIF is fixed and live (2026-10-22). The
service account is `firebase-deployer@`, which already holds Cloud Datastore
Owner, Storage Admin and Service Usage Consumer on `sk8hub-d7806`, so no IAM
grant is needed. The only thing to check is that the Cloud Video Intelligence
API (`videointelligence.googleapis.com`) is enabled (step 1):

```bash
gcloud services list --enabled --project=sk8hub-d7806 | grep videointelligence
```

If it is not, the first `limit=1` apply shows `screener error (annotate
403)` and sends that one clip to review. Enable it and rerun.

A missing API or role shows up as `screener error (annotate 403)` or
`PERMISSION_DENIED` from Firestore on the first clip, which is why the first
apply uses `limit=1`. Apply also mints one
access token before touching any clip, so a broken WIF setup fails up front.

**Run it** after a deploy whose log prints `switch MODERATION: ON`:

```bash
# 1. Dry run: clip ids, ages, states. No writes.
gh workflow run moderation-rescreen.yml -f mode=dry-run

# 2. One clip, then read the log.
gh workflow run moderation-rescreen.yml -f mode=apply -f limit=1 -f confirm=rescreen

# 3. The rest, paced.
gh workflow run moderation-rescreen.yml -f mode=apply -f limit=25 -f confirm=rescreen

# Watch and fetch the log of the latest run.
gh run watch "$(gh run list --workflow moderation-rescreen.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run download --name rescreen
```

**The workflow output is redacted.** The repo is public, so its Actions logs
and artifacts are too, and they must never tie a skater to a moderation
outcome. In CI the script runs with `--redact` (also forced on by
`GITHUB_ACTIONS=true`, with no way to turn it off): each row is clip id, age,
before and after state, action and note only. There are no @handles, uids or
screener error text (that can quote a storage path, which holds the uid), and
no `users/{uid}` reads. The job log prints that redacted section, the
`rescreen` artifact (kept 30 days) is the redacted log, and the job summary is
counts by action only. To see who owns a clip, look its id up in `/admin` or
the Firebase console. Local emulator runs keep handles: the owner's profile
is read only for rows inside `limit`, and other rows show the handle stored on
the clip, or `(unknown)`.

A failed run means a screener error or an early stop. Read the log, and the
Sentry event for a screener error, before rerunning.

**Clips the rescreen cannot screen.** The log lists them with action
`skipped-not-screenable`, the state as `moderation/moderationStatus`, and a
note. The screener only acts on user uploads with `moderation: pending`, so
an admin clears these by hand:

1. Note the clip id and state from the dry-run log.
2. Note says "not a user upload": a game clip or live post. The upload
   screener never handles these. Leave it, and tell Nccode if it shows
   "Checking…" in the app.
3. State `review/pending`: the clip is in the `/admin` queue (Clips in
   review). Open `/admin`, find the clip, then tap **Keep** (approved/active)
   or **Remove** with a reason (removed/hidden, owner notified).
4. Any other state, such as `-/pending` or `approved/pending`: the `/admin`
   queue only lists `moderation == "review"`, so the clip does not show
   there. An admin decides it with the `decideClipModeration` callable
   (`{ clipId, decision: "approved" | "removed", reason }`), the same call
   the Keep and Remove buttons make. It accepts any user clip and fixes both
   fields in one transaction. There is no `/admin` button for this case
   yet; ask Nccode to run it rather than editing Firestore by hand.
5. Run the dry run again. The clip should no longer be listed.

Local runs are for the Firestore emulator only (`FIRESTORE_EMULATOR_HOST`
set, `GOOGLE_CLOUD_PROJECT=demo-skatehubba`); see the script header.

---

## Rollback Plan

### Roll Dice Rollback

```bash
firebase functions:config:unset dice.enabled
firebase deploy --only functions:diceAction,functions:diceSweep
```

Or set `DICE_ENABLED=false` and redeploy.

Unset `VITE_FEATURE_DICE_ENABLED` in Vercel and redeploy.

### Clip Moderation Rollback

Set `MODERATION_ENABLED=false` in Cloud Functions and redeploy:

```bash
firebase deploy --only functions:moderateNewClip,functions:moderateClipReport,functions:decideClipModeration
```

Unset `VITE_FEATURE_CLIP_MODERATION_ENABLED` in Vercel and redeploy.

**Note:** `decideClipModeration` always works (functions have `MODERATION_ENABLED=false`), so admins can clear the review queue.

---

## Monitoring

### Roll Dice

- Watch `diceGames` collection for stuck games
- Check Firebase Functions logs for errors on `diceAction` and `diceSweep`
- Verify `diceSweep` runs every 15 minutes
- Monitor `diceStats` for win/loss tracking

### Clip Moderation

- Watch `clips` collection `moderation` field distribution:
  - Most should be `approved`
  - `pending` should clear within 30 seconds
  - `review` queue should stay small
  - `rejected` should be rare
- Check Video Intelligence API quota and spend
- Monitor Sentry for Video Intelligence errors
- Check `reports` collection for spam

---

## Support Documents

- **Roll Dice:** `/workspace/docs/DICE.md`
- **Clip Moderation:** `/workspace/docs/CLIP_MODERATION.md`
- **App Check:** `/workspace/docs/APPCHECK_ROLLOUT.md`
- **Functions Deploy:** `/workspace/docs/DEPLOY_FUNCTIONS.md`

---

## Deployment Authority

Only Jason can deploy Cloud Functions via the GitHub Actions workflow:

`.github/workflows/firebase-functions-deploy.yml`

This is a manual `workflow_dispatch` that requires `confirm: deploy`.

**Do NOT deploy from CI.** Use the manual firebase CLI commands above for initial tester deploys.
