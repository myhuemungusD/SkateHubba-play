# Video Moderation Design

**Status:** Proposal — awaiting maintainer sign-off before implementation.
**Owner:** (assign during review)
**Last updated:** 2026-04-17

## Why this document exists

SkateHubba is a UGC platform: every match produces up to two user-uploaded
videos (the setter's "set" clip and the matcher's "match" clip). Clips surface
in a public, cross-game feed (`/clips/{clipId}`). Today the only moderation
surface is:

- A `/reports` collection the client can write (see `firestore.rules` lines
  819–854) — but **nothing reads or acts on those reports**.
- A `moderationStatus` field on `clips/{clipId}` with allowed values
  `'active' | 'hidden'` — clients write `'active'` on create; transitioning
  to `'hidden'` is server-only by rule (see `firestore.rules` line 938).
- `src/services/reports.ts` sends reports with rate-limit enforcement.

**There is no server that flips `moderationStatus` to `'hidden'`.** Every report
sits forever in Firestore with no intake, triage, or takedown path. This blocks
three things a real dev team considers non-negotiable:

1. **App Store Guideline 1.2 (UGC Moderation).** Apple requires "a method for
   filtering objectionable material… and the ability to report offensive
   content with timely action." Without it submissions get rejected.
2. **COPPA/child-safety exposure.** Skate videos routinely include minors. One
   inappropriate clip unmoderated for days is the story that ends the app.
3. **DMCA takedown obligations.** Rights-holders must have a way to request
   removal and expect action within a reasonable window.

## Constraints this design respects

Per `CLAUDE.md`:

> No Cloud Functions in PRs. CI gate (`pr-gate.yml`) rejects new code in
> `functions/src/`. Discuss first.

**This document IS the discussion.** Implementation requires a maintainer to
sign off on the Cloud Functions exception before any code lands in `functions/`.

The `functions/` folder already exists in the repo — it just needs a
disciplined entry point, clear boundaries, and coverage.

## Options considered

### Option A — Manual moderation queue only (no automated scanning)

**How it works.** A moderator dashboard (web-only, gated by custom claim
`moderator=true`) lists `/reports` where `status == 'pending'` and offers
accept / reject actions. Accept writes `moderationStatus: 'hidden'` on the
clip and closes the report.

**Pros:** Smallest surface area. No ML costs. Predictable behavior.
**Cons:** Every piece of bad content is live until a human sees the report.
Median takedown time is measured in hours or days. Does not satisfy Apple
for "timely action" on large-scale UGC. Does not scan clips that were never
reported.

**Verdict:** Ships, but only as a first step. Not enough on its own.

### Option B — Automated pre-screening at upload (recommended)

**How it works.** On upload, trigger a Cloud Function that:

1. Fetches the uploaded video from Storage.
2. Sends it to **Google Cloud Video Intelligence API — `EXPLICIT_CONTENT_DETECTION`**
   (native option, no third-party data transfer, per-second cost ≈ $0.10/min of
   video for the first 1000 minutes/month).
3. If any frame scores `LIKELY` or `VERY_LIKELY` on explicit content, flips
   `clips/{clipId}.moderationStatus` to `'hidden'` and writes a
   `/moderation_events/{id}` doc with the score, timestamp, and reason.
4. Asynchronously duplicates scans to a secondary provider (**AWS Rekognition
   Content Moderation** or **Hive Moderation**) for a consensus signal on
   borderline content (`POSSIBLE` tier). Discrepancies enqueue a
   human-review row in the moderator dashboard from Option A.
5. Runs face-count detection. Clips with 0 faces pass; clips with faces
   trigger an age-estimate pipeline — any face estimated <18 with the video
   uploader's `dob` indicating they're an adult produces a high-priority
   moderator queue row.

**Pros:** Content is hidden before it goes live in most cases; Apple expects
exactly this shape; minors are protected by default.
**Cons:** Cost (~$1-3 per 1000 clips at current Video Intelligence pricing).
Latency: video is unavailable for 3-8s post-upload while scanning runs. False
positives on legitimate content — mitigated by the consensus + manual review
path.
**Dependency:** Requires Cloud Functions 2nd gen + Storage trigger. See
"Changes required" below.

**Verdict:** Recommended.

### Option C — Client-side content hashing + blocklist only

**How it works.** Hash each upload (SHA-256) at the client before upload.
Check against a Firestore `/content_blocklist/{hash}` collection. Refuse
upload if hash exists.

**Pros:** Zero recurring cost. Works for known-bad content.
**Cons:** Does NOT scan new content. One-pixel change evades the hash.
Useless for original-upload moderation. Can only ever be a complement to
A or B.

**Verdict:** Not a standalone option; could augment B for known-bad hashes.

## Recommended path

**Combine A + B** sequenced over three PRs:

1. **PR 1 (this design doc + Cloud Functions exception):** Scope + maintainer
   sign-off. No code.
2. **PR 2 (Option A):** Moderator dashboard + custom auth claim + report
   action server function. Closes the "reported clips sit forever" gap.
   Enables App Store submission immediately.
3. **PR 3 (Option B):** Upload-triggered scanner. Closes the "unreported bad
   content goes live" gap.

## Changes required — detailed

### Firestore rules

- Add a `moderators/{uid}` collection or custom auth claim (`moderator: true`).
- Extend `/reports/{reportId}` update rule to allow writes where
  `request.auth.token.moderator == true` and only the `status`,
  `resolvedBy`, `resolvedAt`, `resolution` fields change.
- Extend `/clips/{clipId}` update rule to allow moderators to flip
  `moderationStatus`.
- Add `/moderation_events/{id}` collection — write-only for the Admin SDK,
  read-only for moderators.

### Storage rules

- Already open for read by any signed-in user. No change.
- Add a `contentType` check that the uploading user's dob is present — belt
  and suspenders for COPPA (rules-unit test should lock this in).

### Client

- `src/services/reports.ts` — no change (already writes the report doc).
- `src/components/ClipsFeed.tsx` — filter clients where
  `moderationStatus !== 'active'` client-side as a defense-in-depth layer
  (the rules already gate visibility via the `active == true` check, but
  an explicit client filter keeps stale cache data from leaking).
- New `src/screens/ModerationQueue.tsx` — admin UI, gated by claim check.
- `src/services/moderation.ts` — client service for moderators to accept /
  reject reports.

### Cloud Functions — requires exception

`functions/src/` would gain:

- `moderateClipOnUpload.ts` — Storage `onObjectFinalized` trigger:
  1. Resolves the `clips/{clipId}` doc by deterministic id from the object
     path.
  2. Calls Video Intelligence API with an Explicit Content config.
  3. Writes `/moderation_events/{id}` with the verdict.
  4. If rejected, updates `clips/{clipId}.moderationStatus = 'hidden'`.
- `onReportAction.ts` — Firestore `onDocumentUpdated` trigger for
  `/reports/{reportId}` that handles the moderator's accept action:
  writes the hidden status, emails the clip owner via SendGrid, creates an
  appeal record.
- `dmcaTakedown.ts` — HTTPS callable, accepts a signed DMCA notice, verifies
  the sender's claim against a `/rights_holders/{id}` allow-list,
  hides the clip, emails the uploader.

Each function gets:

- 100% unit test coverage (aligning with the repo's `src/services/` bar).
- A named dead-letter queue for failed scans (clips whose scan fails twice
  default to `hidden` and enqueue a human review).
- Cost budget alert via `/billingAlerts` (the collection already exists in
  `firestore.rules` line 733).

### CI

- `.github/workflows/pr-gate.yml` currently rejects Cloud Functions code.
  Update the allow-list to accept PRs whose description includes the
  "moderation" label and a linked design-doc anchor.
- Add `functions/package.json` lint + typecheck + test jobs.
- Emulator suite already supports Functions (see `firebase.json`).

### Operations

- Allocate a dedicated `moderation@skatehubba.com` inbox.
- Publish a **DMCA notice procedure** at `/legal/dmca` (route already has a
  placeholder shape via the react-router tree in `App.tsx`).
- SLA: acknowledge DMCA within 24h, action within 72h.
- On-call rotation for high-severity reports (minors, violence, CSAM).
- File the **NCMEC CyberTipline** reporting process for any suspected CSAM,
  as required by US law — this cannot wait for product features.

## Non-goals of this document

- Spam detection (separate design — gameplay rate limits already cover most).
- Hate-speech detection on usernames / trick names — simpler text filter via
  an existing allow/deny list, not part of the video pipeline.
- Copyrighted-music detection in videos (YouTube-style Content ID) —
  out of scope until we see actual demand.

## Sign-off checklist

- [ ] Maintainer approves Cloud Functions exception for this feature
- [ ] Legal reviewer signs off on DMCA procedure text
- [ ] Ops reviewer confirms on-call ownership
- [ ] Cost projection ($ per 10k clips) approved by finance owner
- [ ] Privacy policy + Apple Privacy Manifest updated to list
      Video Intelligence + Rekognition as processors
