# Roll Dice & Clip Moderation Deployment Checklist

This document provides step-by-step deployment instructions for Roll Dice and Public Clip Moderation. Both features are built, tested, and ready to deploy.

**Important:** These features remain **OFF** in production until explicitly enabled. Do not deploy to production until tester approval is complete.

---

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
MODERATION_ENABLED=true
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

**Note:** Keep `MODERATION_ENABLED=true` from initial deploy.

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

**Note:** `decideClipModeration` still works with `MODERATION_ENABLED=false`, so admins can clear the review queue.

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
