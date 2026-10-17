# firestore.rules — long-form rationale

Long comment blocks (10+ lines) moved out of `firestore.rules` so the rules source stays under Firebase's 256 KiB limit (GAPS P2-9). The first line of each block stays in the rules file with a pointer to its section here. Text is verbatim.

<a id="r1"></a>

## r1

Precedes: `function FIREBASE_BUCKET() {`

```text
── Project bucket name (audit S5+S12, PR-B) ──
Hardcoded production bucket, REGEX-ESCAPED. Used exclusively
inside `.matches(...)` predicates (avatar URL, video URL pins).
The literal bucket is `sk8hub-d7806.firebasestorage.app`; the
`.` characters are escaped to `\.` so that a similarly-named
attacker bucket (e.g. `sk8hub-d7806xfirebasestoragexapp`) cannot
satisfy the wildcard a raw dot would create. If the project is
ever migrated to a new bucket, update this constant in lockstep
with .firebaserc and VITE_FIREBASE_STORAGE_BUCKET — and remember
to escape every `.` in the new value.
```

<a id="r2"></a>

## r2

Precedes: `function BUCKET_DL_URL_RE() {`

```text
Fully-assembled regex literals. The match-resolution `allow update`
rule sits right under Firestore's per-evaluation 1000-expression
ceiling once main's turn-order seize guard and this PR's video-URL
pins are stacked; assembling the pattern via runtime '+'
concatenation of FIREBASE_BUCKET() multiplied the expression count
at every call site and tipped it over. Returning the finished
literal (still REGEX-ESCAPED, still derived from the same bucket
value — update both in lockstep with FIREBASE_BUCKET above) keeps
each `.matches(...)` to a single string expression.
  • download-URL form only (getDownloadURL output) — used by
    matchVideoUrl / avatar pins.
```

<a id="r3"></a>

## r3

Precedes: `function notBanned() {`

```text
── Ban gate (moderation) ──
Enforcement keys off a TOMBSTONE doc at `bans/{uid}` — never off a
field on the user's own profile. That distinction is load-bearing:
`users/{uid}` is owner-DELETABLE (account-deletion flow), so a
`users/{uid}.banned` flag was trivially bypassable by deleting the
profile (which alone re-opens comments + votes, since a missing
profile cannot be evidence of a ban) and then re-creating it clean —
the create rule forbids seeding `banned`, so the account came back
unbanned and clip uploads resumed. `bans/{uid}` is outside the
owner's reach entirely: admin-only create/delete, owner denied
everything, so the ban survives profile deletion and re-signup on
the same UID.

A banned account keeps READ access but loses every UGC-producing
write: user-source clips, clipVotes (cast + flip) and clip comments.

DELIBERATELY NOT APPLIED TO GAME WRITES: /games rules already sit
near the 10-document-access / 1000-expression ceiling (see the note
above BUCKET_DL_URL_RE), and adding a lookup to every turn action
would tip them over. Accepted gap: a banned user can finish an
in-flight game. Moderation revokes their feed presence, which is the
public surface that matters.

Single `exists()` by design — one document access, no `get()`, which
keeps the user-clip create path (its heaviest caller) inside budget.
```

<a id="r4"></a>

## r4

Precedes: `function userClipVideoUrlOk(url, uid) {`

```text
── User-uploaded clip video pin ──
A user clip is filmed outside a game, so its bytes live under
`userClips/{uid}/` in this project's bucket (see storage.rules).
Pinning the URL to the CALLER's own prefix stops a user from
publishing a feed entry that renders another user's (or another
project's) object. Download-URL form only — `getDownloadURL()` is
the only way the client obtains this value; the bucket-as-host CDN
form is deliberately not accepted here (game clips need it because
they copy the games doc value verbatim; user clips do not).

FIREBASE_BUCKET() is already REGEX-ESCAPED at its definition (every
`.` is `\\.`), so interpolating it here is safe — the same pattern
the profileImageUrl pins use. Keep it escaped if that constant is
ever changed, or a look-alike bucket satisfies the wildcard.
```

<a id="r5"></a>

## r5

```text
── Stats are server-only (client fan-out lockdown) ──
wins/losses/lastStatsGameId used to be closed out by client writes
(the catch-up loop in the former src/context/GameContext.tsx, gated
here by canPeerCloseStats / ownerCanCloseWins / ownerCanCloseLosses).
That fan-out corrupted production counters, so it has been removed.
Stats are now written EXCLUSIVELY server-side: the applyGameStats
Cloud Function (admin SDK, bypasses these rules) increments
users/{uid}.wins/.losses exactly once per terminal game, and a
one-time admin backfill recomputes counters + deletes the dead
lastStatsGameId field. The client stat helpers are therefore gone;
clients may never modify these fields (owner-update backstop below)
and may never forge the game-side statsApplied flag (games rules).
```

<a id="r6"></a>

## r6

Precedes: `function turnHistoryGrowthOk() {`

```text
── turnHistory growth bounds ──
Every write path that legitimately appends to `games.turnHistory`
(match resolution, dispute resolution, Call BS resolution, expired
dispute auto-accept, expired setReview auto-clear) must satisfy BOTH:

  (1) size grows by at most ONE entry per write — otherwise a player
      could `arrayUnion` a giant batch of fabricated TurnRecords.
  (2) absolute size stays ≤ 200 — a SKATE game tops out at roughly
      5 letters × 2 players × ~10 attempts per letter, so 200 is a
      generous ceiling that still protects against the 1 MB
      Firestore doc limit when an attacker inflates TurnRecord blobs.

Accepts the same "absent on both sides" and "unchanged" shapes that
the non-growth branches use, so write paths that DON'T append
(e.g. a judge ruling that doesn't add a turn) still pass cleanly.
```

<a id="r7"></a>

## r7

Precedes: `match /users/{uid} {`

```text
── Users ──
The `users/{uid}` document holds ONLY fields that are safe to expose
cross-user (username, stance, wins/losses, isVerifiedPro, …). Any
sensitive field — email, emailVerified, dob, parentalConsent, and
the `fcmTokens` push-registration list — lives in the private
subcollection `users/{uid}/private/*` and is readable only by the
owning user. Firestore rules cannot filter fields on reads, so the
split at the document boundary is the enforcement mechanism.

Historical note: between the April 2026 public/private split rollout
and the May 2026 backfill completion, the update rule ran in a
transitional form that accepted each sensitive field IFF its value
was unchanged from `resource.data` — necessary because legacy docs
still carried those fields inline and `request.resource.data` is the
merged post-write state. `scripts/migrate-users-private.mjs`
completed in production in May 2026, removing every legacy inline
occurrence, so the strict `!('X' in request.resource.data)` form has
been restored on `update` (matching the long-standing `create` form).

Username constraints MUST match `USERNAME_MIN`, `USERNAME_MAX`, and
`USERNAME_RE` in src/services/users.ts. Rules are the source of truth
at the security boundary; the TS constants exist so the UI can reject
invalid input before a round-trip. Update BOTH when changing limits.
```

<a id="r8"></a>

## r8

Precedes: `&& fsGetAfter('usernames', request.resource.data.username).data.uid == uid`

```text
── Username reservation binding (uniqueness bypass guard) ──
Shape validation above only constrains the STRING; it never
required a companion usernames/{username} reservation to exist.
The legitimate client (src/services/users.ts) always writes both
docs in the same runTransaction, but nothing server-side enforced
that pairing — a direct write could mint users/{uid} with a
username someone else already holds, since the reservation
collection was never consulted. Require the SAME atomic write to
also own (create-or-already-own) usernames/{username}; if that
doc already belongs to a different uid, its `allow update: if
false` rule blocks the write outright, so this getAfter can only
resolve to `uid`. Mirrors the getAfter idiom already used by
clipRateLimitOk() below.
```

<a id="r9"></a>

## r9

Precedes: `&& !(request.resource.data.diff(resource.data).affectedKeys()`

```text
── Privileged-field self-modify guard (F2 — defense in depth) ──
`affectedKeys()` is the set of fields whose VALUE actually
changed between resource.data and request.resource.data. By
gating on `.hasAny([...])` (not `.hasOnly`) we deny any owner
update that mutates one of the immutable / admin-only fields
below, regardless of which other fields the same write touches.

Critically, this works alongside the transitional legacy-field
relaxation a few lines down: a legacy doc carrying e.g. `email`
inline contributes that field to request.resource.data on every
partial update, but it is NOT in affectedKeys() so this guard
ignores it. The per-field guards below remain the canonical
value-equality check; this clause is the comprehensive backstop
that closes self-modify attempts on fields the owner must never
touch (createdAt rewrite, isVerifiedPro grant, wins/losses
inflation, etc.).

Field rationale:
  uid, username, createdAt — identity, immutable post-create.
  isVerifiedPro, verifiedBy, verifiedAt — admin/console only.
  email, emailVerified, dob, parentalConsent, fcmTokens —
    legacy sensitive fields; once moved to /private they must
    never reappear or be re-written on the public doc.
  wins, losses, lastStatsGameId, gamesPlayed, currentWinStreak,
    bestWinStreak, lettersGiven, lettersTaken,
    tricksDisputed, disputesRaised, disputesRight,
    disputesWrong — stats are written exclusively server-side
    (applyGameStats Cloud Function + the one-time admin backfill for
    win/streak counters; the dispute referee for the four dispute
    counters); clients may never modify them. affectedKeys() only contains
    fields whose VALUE changes, so legacy docs still carrying
    lastStatsGameId keep working for benign profile edits
    (stance/avatar) that don't touch it.
```

<a id="r10"></a>

## r10

Precedes: `&& (`

```text
wins / losses / lastStatsGameId are NOT validated here — they are
covered by the affectedKeys().hasAny([...]) immutable backstop
above, which denies ANY owner write that changes their value.
Stats are server-only now (applyGameStats Cloud Function + admin
backfill); there is no client close-out path to gate.
lastGameCreatedAt is the server-side 30s game-creation cooldown
anchor (see /games create rule). Without this guard, a client
could write a stale Timestamp (e.g. epoch 0) to instantly satisfy
the `request.time > lastGameCreatedAt + 30s` check and spam games.
`request.resource.data` reflects the merged post-write state, so
a partial update that doesn't touch the field still carries the
stored value through — the three accepted branches are:
  (A) neither stored nor post-write have it (no cooldown state yet)
  (B) both have it and the value is unchanged (untouched update)
  (C) the new value equals request.time (client wrote
      serverTimestamp()), which is what the game-create flow does
      in the same batch as the game create (the /games create rule
      requires it there via getAfter()).
```

<a id="r11"></a>

## r11

Precedes: `&& (`

```text
── profileImageUrl bucket + UID pinning (PR-B, audit S5+S12) ──
The avatar download URL stored on the profile MUST point at this
project's bucket (FIREBASE_BUCKET above) AND at the calling
user's own UID — otherwise user A could phish opponents by
pointing their public profile at a doppelgänger image hosted on
another user's storage path or another project entirely.

Three accepted shapes (gated on 'in keys()' so writes that don't
touch the field pay nothing here):
  (A) field absent on the post-write state → unchanged
  (B) field explicitly null → fallback initial-circle / SVG path
  (C) field is a string that matches the bucket+uid+ext regex

The `(\\?.*)?$` tail accepts the standard `?alt=media&token=…`
query the Firebase Storage CDN appends; without it, valid URLs
would be rejected the moment the SDK fetched a download URL.
```

<a id="r12"></a>

## r12

Precedes: `allow update: if isAdmin()`

```text
── Verified-Pro grant / revoke (admin custom claim) ──
Deliberately a SEPARATE `allow update` clause: Firestore ORs allow
rules, so the owner clause above is untouched — its
affectedKeys().hasAny([...]) backstop still denies every client
self-grant, and a non-admin's accepted set is byte-for-byte what it
was before this clause existed. This is the ONLY client path that may
change the three pro fields, and it may change NOTHING else:
`hasOnly` pins the affected key set so an admin cannot ride a
username rewrite or a wins inflation along in the same write.
verifiedBy/verifiedAt are the audit trail — pinned to the acting
admin and to server time so a grant can never be forged onto another
moderator or back-dated.

SELF-GRANT IS FORBIDDEN (`uid != request.auth.uid`): a single
compromised admin token must not be able to mint its own Verified-Pro
badge, and the four-eyes shape means every client-side grant is
attributable to a DIFFERENT operator than its subject. Founder / first
-admin self-verification is still possible out-of-band via
scripts/grant-pro.ts, which runs on the Admin SDK and bypasses these
rules entirely — that path is deliberately not client-reachable.
```

<a id="r13"></a>

## r13

Precedes: `allow update: if isAdmin()`

```text
── Ban flag mirror (admin custom claim) ──
NOT the enforcement point — `bans/{uid}` is (see notBanned()).
This field is a DISPLAY mirror for the moderation console and
profile badges, kept admin-writable so it can be maintained in the
same operator flow. Because users/{uid} is owner-deletable, a ban
recorded ONLY here would be shed by deleting and re-creating the
profile; never gate a write on it.

Mirrors the Verified-Pro clause above field-for-field, and for the
same reasons: a separate `allow update` so the owner clause is
untouched (its affectedKeys().hasAny([...]) backstop now lists
'banned', so an owner can neither ban anyone nor self-unban),
`hasOnly(['banned'])` so a ban cannot ride along with a username
rewrite, and `uid != request.auth.uid` so a single compromised
admin token cannot quietly unban itself.
```

<a id="r14"></a>

## r14

Precedes: `match /private/{docId} {`

```text
── Private profile (subcollection) ──
Owner-only read/write surface for sensitive fields that must
never leak cross-user: email, emailVerified, dob, parentalConsent,
and the fcmTokens push-registration list. The canonical doc is
`users/{uid}/private/profile`; {docId} is open in the matcher so
a future split (e.g. `users/{uid}/private/fcm`) doesn't require
a rules change, but every doc stays owner-only.

The fcmTokens cap (≤10 entries, must be a list) moves with the
field — prevents a compromised client from stuffing an unbounded
blob into the push-token list, the same attack the previous
guard on the public user doc closed.
```

<a id="r15"></a>

## r15

Precedes: `function onboardingTutorialVersionOk() {`

```text
── Onboarding field shape validation ──
The onboarding service (src/services/onboarding.ts) writes three
fields here via setDoc(..., { merge: true }):
  - onboardingTutorialVersion: int >= 0  (TUTORIAL_VERSION bump
                                           is monotonic; null is
                                           valid only via the
                                           explicit reset path)
  - onboardingCompletedAt:    serverTimestamp() | null | timestamp ≤ now+5s
  - onboardingSkippedAt:      serverTimestamp() | null | timestamp ≤ now+5s

Without these checks a malicious client can stuff arbitrary
shapes ("attack", { nested: true }, etc.) into the private doc
and wedge readers in src/services/onboarding.ts that do
`typeof === "number"` / Timestamp duck-typing. Each predicate is
gated on `field in request.resource.data` so unrelated writes
(fcmTokens, emailVerified, etc.) pay zero validation cost.

The serverTimestamp() sentinel is detected via the same idiom
already in use elsewhere in this file (see lastGameCreatedAt /
lastSpotCreatedAt above): when the client uses the sentinel,
`request.resource.data.field == request.time`.
```

<a id="r16"></a>

## r16

Precedes: `match /bans/{uid} {`

```text
── Bans (moderation tombstones) ──
The AUTHORITATIVE ban record, keyed by UID. Deliberately a top-level
collection rather than a field on users/{uid}: the profile doc is
owner-deletable and owner-recreatable, so any flag stored on it can
be shed by deleting the account and signing up again on the same
UID. This doc is unreachable by its subject in every verb, so a ban
survives profile deletion, re-signup, and username changes.

`notBanned()` reads this with a single exists() — the doc's mere
presence is the ban. Fields are the moderation audit trail only.
```

<a id="r17"></a>

## r17

Precedes: `function matchResolutionPinsOk(cur, nxt) {`

```text
── Match-resolution turn-order seize guard (P0) ──
Extracted from the matching-phase `allow update` rule (PR
claude/video-url-security) and flattened so the matching→* resolution
write stays under Firestore's per-evaluation node ceiling once main's
#373 seize guard and this PR's matchVideoUrl `.matches()` pin both apply.
Cheap phase/status discriminators are checked first in each branch so the
OR short-circuits before the costlier judgeActive()/opponentUid() calls.

The accepted set is IDENTICAL to main's inline four-branch form — the
shared `status == 'active' && winner == null` invariant of every
non-completion outcome is hoisted once; completion (status == 'complete')
is the lone remaining alternative. No new states are admitted. `cur` is
resource.data, `nxt` is request.resource.data. Per-outcome pins:
  • missed-continues (games.match.ts 315-321):
      currentSetter UNCHANGED, turnNumber +1, currentTurn == currentSetter
  • completion (312-314): currentSetter + turnNumber UNCHANGED,
      winner = opponent of the player who hit 5 letters
  • honor+landed: FREEZE into pendingReview. Roles, turn, letters, and
      turnHistory stay pinned. The only role swap is the setter's later
      accept on the pendingReview branch. A matching→setting swap is denied.
  • judge landed→disputable (169-176) / Call BS→setReview
      (games.judge.ts 45-51): currentSetter + turnNumber UNCHANGED,
      currentTurn routes to the judge
```

<a id="r18"></a>

## r18

Precedes: `|| (nxt.phase == 'pendingReview'`

```text
Honor system + landed — BINDING-DISPUTE FREEZE.
The matcher's landed submission FREEZES the game in pendingReview
so the setter gets a 24h accept/dispute window (resolved by the
pendingReview allow-update branch below). NOTHING resolves on this
write: currentSetter, currentTurn, turnNumber, letters and
turnHistory are ALL pinned unchanged (no TurnRecord appended — the
turn is not over). reviewFor names the matcher (opponent of the
current setter, which in matching phase is cur.currentTurn);
reviewDeadline is a fresh ~24h timestamp. Honor-only: judge must
NOT be active. matchVideoUrl is bucket-pinned by matchVideoUrlOk in
the enclosing rule; statsApplied by statsAppliedUnchanged().

The old matching→setting instant swap is gone. In-flight games keep
every other arm (miss, complete, judge routing, and this freeze).
A game already in pendingReview still accepts through that branch.
```

<a id="r19"></a>

## r19

Precedes: `function statsAppliedUnchanged() {`

```text
── statsApplied is server-only (stats fan-out lockdown) ──
`statsApplied` on a game doc is written EXCLUSIVELY by the
applyGameStats Cloud Function (admin SDK, bypasses these rules): it
flips to true inside the same transaction that credits wins/losses
for a terminal game, exactly once. A client must never introduce or
change it — pre-setting statsApplied:true would make the Cloud
Function treat the game as already-credited and skip the loser's loss
forever. Every /games update branch pins it to its stored value via
this helper, and the create rule forbids it outright.

Presence-pair form (NOT request.resource.data.get('statsApplied',
false)) on purpose: the .get()-with-default idiom trips the "Null
value error" engine quirk documented on the spotId immutability pin
in the games match below. This helper reads no documents — plain
field comparison — so it adds negligible node cost to each branch
(and net expression budget improves now that the three get()-heavy
stat helpers are gone).
```

<a id="r20"></a>

## r20

Precedes: `function cronNotifyTombstonesUnchanged() {`

```text
── Cron notification tombstones are server-only ──
`challengeNotifiedAt` and `turnReminderSentFor` are written EXCLUSIVELY
by api/cron/sweep-expired-turns.ts (Admin SDK, bypasses these rules) and
read back by it as "already handled, skip this game" marks. They sit on
the GAME doc rather than the notification doc because the recipient can
delete a notification, which would otherwise resurrect the buzz every
tick. That makes them a suppression lever pointed at the OPPONENT:
  • challengeNotifiedAt non-null → the challenge backstop skips the game,
    so a challenger who seeds it and never sends the client notification
    leaves the opponent unaware while the 24h forfeit clock runs.
  • turnReminderSentFor == turnNumber → the "2 hours left" reminder is
    skipped. setting→matching is the write that hands the turn over AND
    leaves turnNumber unchanged, so one smuggled field on the hot path
    silences that turn's warning.
Both end in a free forfeit win, so every /games update branch pins them
and the create rule forbids them outright. Unlike the rest of this file
the /games block has no keys().hasOnly() allowlist — an unrecognised
field is accepted by default — so this explicit pin IS the enforcement.
Presence-pair form (not .get(field, default)) for the same "Null value
error" engine quirk noted on statsAppliedUnchanged(); reads no documents.
```

<a id="r21"></a>

## r21

Precedes: `function verifiedProBadgesUnchanged() {`

```text
── player{1,2}IsVerifiedPro are bound at create, immutable on every update ──
The create rule binds each field to the authoritative
users/{uid}.isVerifiedPro (badge-forgery guard, mirrors the username
impersonation guard). Pro status can change mid-game (admin grants it
elsewhere), but that must not retroactively relabel an in-progress
game — no update path legitimately rewrites either field, so every
/games update branch pins them to their stored value here.
Presence-tolerant (mirrors judgeUsernameUnchanged) so non-Pro players
(field omitted entirely — see games.create.ts) and any legacy doc that
predates the field both pass.
```

<a id="r22"></a>

## r22

Precedes: `&& (`

```text
── Verified Pro badge forgery guard ──
player{1,2}IsVerifiedPro are denormalized for the lobby/scoreboard
UI (WaitingHeader, useLobbyController, LetterScoreboard) so those
screens don't need an extra profile read. The legitimate client
only ever echoes back its own already-fetched
users/{uid}.isVerifiedPro (see GameContext.tsx) and omits the
field entirely when false (games.create.ts), but nothing bound
that server-side — same impersonation shape as the username guard
above, and it reuses the same two get()s (+0 reads). Presence-
optional: a field, if present, must match the authoritative
source; absence always passes (covers the false/legacy case).
```

<a id="r23"></a>

## r23

Precedes: `&& fsGetAfter('users', request.auth.uid).data.get('lastGameCreatedAt', null) == request.time`

```text
Rate limit: at most one game creation per 30 seconds per user.
The PRE-write lastGameCreatedAt (get) must be absent (first game
ever) or older than 30s, AND the same batch must stamp the anchor
to request.time (getAfter). Before the getAfter() binding the
anchor was a separate best-effort write, so a client that simply
never sent it skipped the cooldown entirely. The users/{uid}
update rule already pins a written lastGameCreatedAt to
request.time, so the anchor can only move forward. Both docs are
already fetched above (users/{auth.uid}), so this adds at most the
one post-write read.
```

<a id="r24"></a>

## r24

Precedes: `allow update: if resource.data.phase == 'disputable'`

```text
Expired-window rules are first in this OR-chain. Their success
path used to evaluate every earlier games update and cross
Firestore's 1000-expression cap. A non-matching phase fails on
the first compare, so setting and matching writes pay two
compares and then their own rule.
── Expired dispute auto-accept ──
When the judge's review window expires (24 h), any participant
(player or judge) can trigger auto-accept: matcher's "landed" call
stands, roles swap, no letters change, game continues.
Phase, expiry, and the post-write phase/status fail every other
games update before isParticipant() and the history pins. This
rule used to sit at the end of the OR-chain and crossed the
1000-expression cap on a legitimate auto-accept.
```

<a id="r25"></a>

## r25

Precedes: `allow update: if resource.data.phase == 'matching'`

```text
── Match resolution (matcher submits an attempt) ──
Honor system (no active judge):
  • missed  → matcher +1 letter, phase=setting (or complete)
  • landed  → matcher's call stands; roles swap, phase=setting
With active judge:
  • missed  → matcher +1 letter (matcher admitting doesn't dispute)
  • landed  → phase=disputable, currentTurn routes to judge

Call BS (judge only): matcher transitions matching → setReview with
currentTurn = judgeId. Split out as its own branch for clarity.
```

<a id="r26"></a>

## r26

Precedes: `allow update: if resource.data.phase == 'pendingReview'`

```text
── Pending-review resolution (honor-system binding dispute, Phase 2) ──
A matcher's landed claim now freezes the game in `pendingReview` (see
the pendingReview arm of matchResolutionPinsOk above) instead of
instantly swapping roles. From the frozen state ONLY the SETTER — the
player whose trick was matched, i.e. resource.data.currentSetter — has
two legal moves, and this branch is the ONLY client write out of
pendingReview:
  (a) ACCEPT  → setting        : the deferred honor swap. Roles rotate
      to the matcher, currentTurn follows, turnNumber +1, ONE landed
      TurnRecord appended, review fields cleared. This is the only
      client path that rotates roles after a landed claim.
  (b) DISPUTE → communityReview: hand the call to the crowd. Roles,
      turnNumber, letters and turnHistory ALL stay frozen; reviewFor
      keeps naming the matcher; reviewDeadline is reset to a fresh vote
      window. The dispute doc (disputes/{gameId}_{turnNumber}) is
      created in the SAME transaction — its create rule binds to this
      still-pendingReview game state (Gap A closure, see /disputes).
The matcher is the CLAIMANT and can never self-resolve their own claim.

FREEZE NOTE: `communityReview` has NO allow-update branch anywhere in
this file, so once a game reaches it NO client can move letters, turn,
roles, phase, winner or status — the game is frozen until the admin
referee (Admin SDK, bypasses these rules) resolves it. That absence IS
the enforcement; do not add a client communityReview branch.
```

<a id="r27"></a>

## r27

Precedes: `allow read: if isSignedIn() && resource.data.isActive == true;`

```text
Active spots are readable only by signed-in users. Requiring auth
closes the anonymous-scraping attack surface: without it, any drive-
by attacker could enumerate every spot + join with clips + users to
build a user-location graph (privacy incident + App-Store location-
data disclosure exposure). Inactive (soft-deleted or moderation-
hidden) spots remain unreadable by anyone through this rule. All
write paths below remain auth-gated (unchanged).

NOTE: the SpotMap / SpotDetailPage screens are accessed from within
the app after auth — there are no public unauth reads in the client
(verified by grep over src/services/spots.ts + screens/SpotDetailPage).
Deep-links to /spots/:id land on the sign-in gate first when called
by a signed-out user.
```

<a id="r28"></a>

## r28

Precedes: `&& (`

```text
Companion-write requirement (May 2026 H2 hardening): a /notifications
create must commit ATOMICALLY with one of two anchors so a malicious
client can't write /notifications and skip the cooldown bookkeeping
(or, worse, omit it entirely and spam an opponent's feed).

  Path A — standalone (writeNotification): the same batch must write
  notification_limits/{senderUid_gameId_type} with lastSentAt pinned
  to request.time. Mirrors the /reports + /nudges companion-write
  pattern, and refreshes the 5s cooldown anchor in lockstep with
  the notification.

  Path B — in-tx (writeNotificationInTx): the notification is part
  of a runTransaction that also updates /games/{gameId} with
  updatedAt = serverTimestamp() (i.e. request.time). Every game
  action that emits an in-tx notification already does this, and
  game writes are themselves rate-limited (turn-action 2s
  server cooldown + turn-order rules), so we don't need a second
  limits doc on the in-tx hot path.

getAfter() reflects the post-commit state; if neither anchor lands
in the same batch the rule rejects.
```

<a id="r29"></a>

## r29

Precedes: `match /pushTargets/{uid} {`

```text
── Push targets (cross-readable token mirror) ──
The canonical FCM token list lives at users/{uid}/private/profile
.fcmTokens (owner-only). This mirror exposes the same tokens to any
signed-in user so a SENDER (game opponent / nominated judge) can
embed them into a /push_dispatch doc — the Firebase Extension that
dispatches background push reads `tokens` from each dispatch doc.

Why cross-readable is bounded risk: FCM tokens alone cannot be turned
into a push attack — the FCM HTTP API requires OAuth2 with the
project's service account, which only the Extension (running as
Admin SDK) has. A leaked token can be paired with a uid (privacy
leak surface) but cannot be abused for push spam by another
authenticated user. The /push_dispatch create rule below additionally
requires the sender to be a game participant AND requires
`tokens.hasOnly(<mirror>)` so a sender cannot inject bogus tokens to
misroute pushes.

Cap mirrors the canonical fcmTokens cap (≤10) — keeps fan-out bounded
even when a user is signed in on every device they own.
```

<a id="r30"></a>

## r30

Precedes: `match /push_dispatch/{dispatchId} {`

```text
── Push dispatch (Firebase Extension trigger collection) ──
The `firebase/firestore-send-fcm` Extension watches this collection
(configured in extensions/firestore-send-fcm.env) and forwards each
created doc to the FCM HTTP API. The extension runs as Admin SDK so
it bypasses these rules — they only gate CLIENT writes to keep
attackers from spamming the FCM API via injected dispatch docs.

Why this collection exists: client-side dispatch is the only way to
wake offline recipients without a Cloud Function (which the
verify-no-cloud-functions CI gate blocks). The Extension is a managed
deployment outside functions/src/, so it slips past the gate cleanly.

Anti-abuse posture:
 1. Sender must be a signed-in game participant
 2. Recipient must be a participant of the same game (player or judge)
 3. tokens.hasOnly(<recipient's mirror>) — no token injection
 4. Title/body caps mirror /notifications (≤80 / ≤200) to bound payload
 5. Rate anchor: a fresh /notification_limits or /games update by the
    SAME sender for the SAME (game, type) must exist within 10s.
    Transfers /notifications' 5s rate limit to /push_dispatch by
    reference — a client cannot dispatch faster than they can
    legitimately notify.

The 10s window (vs the notification's 5s) absorbs the network gap
between /notifications commit and /push_dispatch commit. Both anchors
are committed BEFORE this rule evaluates, so get() (not getAfter)
is the right primitive.
```

<a id="r31"></a>

## r31

Precedes: `&& request.resource.data.type in ['your_turn', 'new_challenge', 'game_won', 'game_lost', 'judge_invite', 'nudge']`

```text
'nudge' is push-only — it has NO /notifications feed entry (nudges
live in /nudges with their own 1-hour cooldown) but it is the one
event that is useless without waking an offline device. Adding it
here opens no new amplification surface: a nudge dispatch still needs
the sender to be a participant, still needs tokens.hasOnly(<mirror>),
still needs the companion push_dispatch_limits write, and the
originating /nudges write is bounded by /nudge_limits at 1 per hour
per (sender, game) — an order of magnitude tighter than the 5s
dispatch cooldown. Deliberately NOT added to /notifications or
/notification_limits: the in-app feed schema stays as it is.

Note this rule does not require games.status == 'active' the way the
/nudges create rule does. That asymmetry is intentional and safe: the
dispatch doc can only exist if the sender already wrote a /nudges doc
that passed the active-game check, and the other push types
(game_won / game_lost) are by definition emitted for a game that is
no longer active. Adding an active-game requirement here would break
game-over pushes.
```

<a id="r32"></a>

## r32

Precedes: `&& fsGetAfter('push_dispatch_limits', request.auth.uid + '_' + request.resource.data.recipientUid + '_' + request.resource.data.gameId + '_'`

```text
── Companion-write rate limit (Codex P1 hardening) ──
Each /push_dispatch create MUST commit atomically with a fresh
/push_dispatch_limits/{senderUid_recipientUid_gameId_type} doc
pinned to request.time. The limits-doc rules enforce a 5s
cooldown on update (matches /notifications), so the sender
cannot fire more than 1 dispatch per 5s per
(recipient, game, type) tuple.

Why this replaces the previous recency-window anchor: a sliding
"notification_limits OR games.updatedAt within 10s" gate let one
legitimate game action authorize an unbounded burst of
/push_dispatch docs in the same window — each triggering an FCM
API call. Binding to a unique companion-write closes that
amplification surface (see notification_limits / reports_limits
/ nudge_limits — same pattern).

getAfter() resolves to the post-batch state, so the rule checks
that the limits doc the sender included in this batch has its
lastSentAt server-pinned to request.time. The limits-collection
create rule enforces the same pin, so a backdated value can't
satisfy both gates.
```

<a id="r33"></a>

## r33

Precedes: `match /reports/{reportId} {`

```text
── Reports (content/player flagging for Google Play UGC policy) ──
Users can report opponents in games they participate in. The previous
rule leaned on a client-side "query + check" comment to enforce
uniqueness; that's harassment-vector and moderator-queue-DoS bait.
Server-side rate limit: one report per (reporter, reported) pair per
1 hour, enforced by requiring a companion write to
`reports_limits/{reporterUid}_{reportedUid}` in the SAME batch.
(That caps the worst case at 24 reports/day against a single target
per reporter — fine for moderation triage; no per-day counter needed.)

Report CONTENT is immutable once created; only the moderation
close-out fields may change, and only via the Admin SDK or an
`admin: true` console operator (see the update rule below).
```

<a id="r34"></a>

## r34

Precedes: `allow update: if isAdmin()`

```text
── Moderation close-out (admin custom claim) ──
Reports stay immutable to everyone else — a reporter can never
rewrite their own filing. An admin may only move a report to a
TERMINAL state with an audit trail: `pending` is not an accepted
target, so a report cannot be silently reopened/recycled, and
`hasOnly` keeps reason/description/gameId/clipId/disputeId (the evidence) and
reporterUid/reportedUid (the parties) frozen in the same write.

The close-out is ONE-WAY: only a still-`pending` report may be
actioned. Without this, a second admin (or a replayed token) could
overwrite an existing verdict — flipping resolved→dismissed and
rewriting resolvedBy/resolvedAt — which destroys the audit trail of
who actually adjudicated the report.
```

<a id="r35"></a>

## r35

Precedes: `match /clips/{clipId} {`

```text
── Clips (landed-trick feed) ──
Denormalized from games.turnHistory, written atomically inside the same
runTransaction that appends the TurnRecord (see src/services/clips.ts
writeLandedClipsInTransaction). Each landed turn can produce up to two
clips: `set` (setter's landed set) and `match` (matcher's landed match,
only when they actually landed it).

Integrity rests on four constraints:
  1. Deterministic doc id `${gameId}_${turnNumber}_${role}` — idempotent
     under transaction retry and prevents duplicates.
  2. Writer must be a participant of the referenced game (verified via
     get() against the game doc), matching the write privileges that
     already govern turnHistory growth.
  3. Create sets moderationStatus == 'active' and cannot be updated by
     clients — transitions to 'hidden' happen via Admin SDK in response
     to a user report (App Store Guideline 1.2 moderation requirement).
  4. Owner (playerUid) can delete their own clip — closes the GDPR /
     CCPA right-to-erasure loop from the account-deletion flow.

Active clips are the public feed. Pending, in-review, rejected, and
removed docs (videoUrl and the explicit scores) stay with the owner
and admins. Blocklist filtering of the public feed stays client-side.
```

<a id="r36"></a>

## r36

Precedes: `&& videoUrlBucketPinned(request.resource.data.videoUrl)`

```text
── videoUrl bucket pin (audit P2) ──
The clip feed is app-wide readable and renders this URL directly.
Without a host pin, any signed-in participant could stamp an
attacker-hosted URL ("https://attacker.com/payload.html") into
the public feed — same referrer/exfil/content-spoof surface as
matchVideoUrl above. Pin to this project's Firebase Storage
bucket only; mirrors the currentTrickVideoUrl pin on the games
collection — BOTH accepted forms must be allowed here because
`writeLandedClipsInTransaction` copies the (already-pinned)
games video URL into clips.videoUrl verbatim, and the games
rule accepts the bucket-as-host CDN form too.
```

<a id="r37"></a>

## r37

Precedes: `allow update: if isSignedIn()`

```text
Clips are otherwise immutable once written — content edits and
moderation flips both go through Admin SDK to keep the audit trail
clean. The narrow exception is the two vote aggregates, which a
signed-in user can adjust ONLY when paired with the corresponding
clipVotes/{uid}_{clipId} create, delete, or delete+create flip in
the same atomic write (see src/services/clips.ts). The
exists/existsAfter/getAfter checks in clipVoteDeltaOk bind BOTH
deltas to the pre- and post-transaction state of the vote doc AND
to its `value`, so a client cannot move a counter without moving
its own vote in the matching direction.
```

<a id="r38"></a>

## r38

Precedes: `match /clipVotes/{voteId} {`

```text
── Clip upvotes ──

One vote per (uid, clipId) enforced by the deterministic document id
(`${uid}_${clipId}`). The id is verified at create time so a client
cannot impersonate another user's vote. Votes are immutable:

  - update allowed ONLY as a direction flip (up ⇄ down); a vote can
    never be silently rewritten into a different shape or retargeted.
  - delete owner-only AND self-correcting: it must carry the matching
    counter decrement (or prove there is none to carry), which closes
    the cast → delete → cast stuffing cycle. See the delete rule.

Reads are open to signed-in users because the clips feed aggregates
votes via `getCountFromServer` and checks whether the current user
already upvoted via a direct get — both in `fetchClipUpvoteState`
(see src/services/clips.ts), and both require read permission on
the collection / doc.
```

<a id="r39"></a>

## r39

Precedes: `allow update: if isSignedIn()`

```text
── Vote flip (up ⇄ down) ──
A flip is issued as delete + set of the SAME voteId inside ONE
transaction. Firestore COALESCES multiple writes to one document
into a single mutation, so the rules engine sees that pair as an
UPDATE — verified against the emulator: a blanket
`allow update: if false` rejects every flip outright. This clause
is therefore the narrowest opening that makes a flip possible:
  • identity fields (uid, clipId) frozen, so a vote can never be
    retargeted at another clip or another user;
  • `value` must actually INVERT — re-writing the same direction
    stays denied, which is what keeps the double-vote guard alive;
  • createdAt re-stamped to server time, so the flip is auditable
    and cannot be back-dated.
Nothing else about a vote is mutable, and the paired counter move
on /clips is validated independently by clipVoteDeltaOk.
```

<a id="r40"></a>

## r40

Precedes: `allow delete: if isSignedIn()`

```text
Owner-only delete, and — crucially — the delete must CARRY ITS OWN
COUNTER CORRECTION. A bare delete would reset the create rule's
implicit one-vote-per-(uid, clipId) guard (the deterministic doc id
is free again) while leaving the earlier +1 on the clip, so a single
account could cycle cast → delete → cast → … and add +1 to the same
clip every lap. Forcing the paired -1 makes that cycle net zero:
stuffing is blocked by arithmetic, not by forbidding the delete,
which is what keeps the withdraw path (clips.votes.ts#removeClipVote)
and the account-deletion cascade (clips.cascade.ts) working.
A FLIP is delete + set of the same voteId in one transaction, which
Firestore coalesces into an UPDATE — it lands on the flip clause
above, never here.
```

<a id="r41"></a>

## r41

Precedes: `match /disputes/{disputeId} {`

```text
── Disputes (community-judged trick calls) ──
When a matcher claims "I landed it", the SETTER can send the call to
the community instead of accepting it on the honor system. The clip
enters the feed and any OTHER signed-in user rules LAND or BAIL.

Shape mirrors the clips collection deliberately — same integrity
constraints, same proven pattern:
  1. Deterministic doc id `${gameId}_${turnNumber}` — idempotent under
     transaction retry, and a turn can only be disputed once.
  2. Writer must be a participant of the referenced game (get() against
     the game doc) AND specifically the SETTER of that turn. Only the
     player whose trick was matched gets to question the claim.
  3. Create seeds status 'open' / moderationStatus 'active' / tallies
     at 0; clients can never forge a pre-loaded verdict, and takedowns
     stay Admin-SDK-only (App Store Guideline 1.2).
  4. matchVideoUrl is bucket-pinned — it renders in a public feed, the
     same exfil / content-spoof surface clips.videoUrl guards against.

Open disputes form the signed-in judging feed. Closed results are game
history: readable by the two players named on the dispute, and by any
voter who ruled on it (their vote doc is the proof — the "see how you
ruled" contract fetchDisputeViewerState documents, and what lets
deleteUserDisputeVotes pair its erasure delete with the -1 tally move
on a closed dispute). The uid pins are trustworthy because the create
rule below binds setterUid/matcherUid to the backing game's real
players, so no cross-doc get() is needed — which also keeps
deleteUserDisputes' setterUid erasure QUERY provable (a get()-based arm
cannot be evaluated for list requests and would deny the whole query).

`resource == null` keeps reads of MISSING docs open to any signed-in
user: raiseDispute's transactional exists-check and the game-over
screen's legacy fallback probe both get() deterministic ids that may
not exist, and a rule that dereferences resource.data denies those
reads outright. This arm leaks only existence — strictly less than the
app-wide read it replaces.
```

<a id="r42"></a>

## r42

Precedes: `&& request.resource.data.setterUid == request.auth.uid`

```text
Only the setter of the disputed turn may raise it — never the
matcher (they'd be disputing their own claim), never the judge.

── Gap A (role self-assertion) — CLOSED (binding-dispute Phase 2) ──
Previously the rule could only assert `setterUid == request.auth.uid`
(the WRITER is who they claim) but had nothing server-side to prove
that uid actually set the trick on `turnNumber` — so the matcher
could invert the roles and dispute their OWN claim. That was
survivable only while the verdict was non-binding. Now the verdict is
binding, so the gap is CLOSED by the freeze: a landed claim parks the
game in `pendingReview` with `currentSetter`/`turnNumber` still naming
the disputed turn, so the rule binds the disputer to the real frozen
setter of the real frozen turn. All three reads below hit the SAME
game doc already fetched by isParticipant()/the player pins — Firestore
dedupes identical document accesses, so this adds ZERO to the
document-access budget (one /games get total for the whole rule).
```

<a id="r43"></a>

## r43

Precedes: `allow update: if isSignedIn()`

```text
Vote tallies.

── Why a symmetric -1 branch exists, despite "a verdict is final" ──
"No un-vote" is a PRODUCT rule, enforced where product rules belong:
the UI ships no retract affordance. It is deliberately NOT a
rules-level invariant, because making it one is strictly worse on two
counts. (1) Integrity: with delete allowed but no decrement, one
account cycles vote → delete vote doc → the !exists() guard resets →
vote again, and every +1 sticks. Unbounded ballot stuffing. Pairing
the delete with a mandatory -1 makes that cycle net ZERO — stuffing
becomes arithmetically impossible rather than merely forbidden.
(2) Erasure: the account-deletion cascade
(services/disputes.cascade.ts → deleteUserDisputeVotes) must be able
to reap a user's verdicts from OPEN disputes. Gating deletes on
status would strand a deleted user's recorded verdict on every live
dispute — a real GDPR/CCPA gap in a repo that maintains explicit
cascade functions for exactly this.

Do NOT "restore" the asymmetry by dropping the -1 branch: that
re-opens both holes. Integrity lives here; affordances live in the UI.
```

<a id="r44"></a>

## r44

Precedes: `allow delete: if false;`

```text
── Gap B (delete + re-raise wipes an unfavourable tally) — CLOSED ──
(binding-dispute Phase 2). Previously the setter could delete their own
dispute and re-raise from a zeroed tally to wipe an unfavourable vote.
Survivable only while the verdict was non-binding; now that a verdict
writes real letters/turn order, that reset is a forgery vector, so the
client delete is REMOVED entirely. The dispute lifecycle is now
Admin-SDK-only: the server referee's `open → closed` close-out (not a
client delete) ends a dispute, and the deterministic id already caps it
at one dispute per turn.

Erasure is unaffected on the VOTE side: the account-deletion cascade
reaps a user's verdicts through the /disputeVotes owner-delete rule
(services/disputes.cascade.ts → deleteUserDisputeVotes), which still
carries its paired tally decrement and is NOT touched here.

COORDINATION (firebase-engineer): services/disputes.cascade.ts →
deleteUserDisputes (client deleteDoc of dispute docs raised by the
departing user) now fails closed. It is best-effort / non-blocking
(Promise.allSettled, warn-and-swallow) so account deletion still
succeeds, but raised-dispute docs must instead be reaped server-side by
the referee. Rework that function out of the client cascade when the
referee lands (Phase 4).
```

<a id="r45"></a>

## r45

Precedes: `allow delete: if isSignedIn()`

```text
Owner-only delete, and — crucially — the delete must CARRY ITS OWN
TALLY CORRECTION. A bare delete would reset the +1 branch's !exists()
guard while leaving the earlier increment on the board, so one
account could cycle vote → delete → vote → … and add +1 every lap.
Forcing the paired -1 makes that cycle net zero: stuffing is blocked
by arithmetic, not by forbidding the delete, which is what keeps the
account-deletion cascade working on OPEN disputes (see the update
rule above for the full rationale).

Note this is NOT status-gated: erasure must succeed on closed
disputes too. A closed dispute's tally is "final" as a product
statement; it must still shed the verdicts of a deleted account.
```
