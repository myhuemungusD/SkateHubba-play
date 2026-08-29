# Notification System Audit

**Date:** 2026-04-16
**Last updated:** 2026-08-26 (reconciled contradictory finding statuses; rules citations now use `match` block names — the line numbers had drifted ~1,300 lines)
**Scope:** All notification paths — Firestore rules, the push dispatcher, client services, UI components, push (FCM), test coverage

---

## System Overview

The notification system has three delivery channels:

1. **Firestore real-time** — Client writes to `/notifications`, recipient's `onSnapshot` listener surfaces in-app toasts
2. **FCM push** — Historically served by application-authored Cloud Functions (`onGameUpdated`, `onGameCreated`, `onNudgeCreated`); those were removed with the `functions/` package. A `firestore-send-fcm` Firebase Extension was then documented as the replacement dispatcher — see **BUG-3** below; it never existed, and for that entire period no OS-level push was delivered at all. Background push is now dispatched by `api/cron/drain-push-dispatch.ts`, a Vercel serverless endpoint on a five-minute GitHub Actions schedule. Clients collect FCM tokens via `src/services/fcm.ts` and write dispatch jobs to `/push_dispatch` via `src/services/pushDispatch.ts`; the drain endpoint consumes that collection, sends via the FCM API with admin credentials, prunes dead tokens, and deletes what it processed. See `firestore.rules` for the create contract.
3. **Client-side game watchers** — `GameNotificationWatcher` detects game state changes from the existing games `onSnapshot` and fires local toasts

Deduplication logic in `GameNotificationWatcher` suppresses FCM foreground messages for types already covered by Firestore watchers.

---

## Findings

### BUG-1 (High): Client delete operations always fail — Firestore rules deny all deletes

**Status:** Resolved. The `match /notifications` block in `firestore.rules` now allows `delete` when `resource.data.recipientUid == request.auth.uid`. The original finding is preserved below for history.

**Files:**

- `src/services/notifications.ts:133-135` (`deleteNotification`)
- `src/services/notifications.ts:140-145` (`deleteUserNotifications`)
- `src/context/NotificationContext.tsx:172-176` (`dismissNotification`)
- `src/context/NotificationContext.tsx:162-169` (`clearAll`)
- `firestore.rules` `match /notifications` block (`allow delete: if false` at the time of the audit)

**Problem:** The client code calls `deleteDoc` on notification documents, but the Firestore rule unconditionally denies deletes. Every delete attempt throws a permission-denied error.

- `dismissNotification` catches the error silently (`.catch(() => {})`), so the UX appears to work — the local state updates and the notification disappears from the bell dropdown. But the Firestore document persists.
- `clearAll` → `deleteUserNotifications` also catches silently. The bell clears locally but all docs remain server-side.

**Impact:**

- Notification documents accumulate in Firestore indefinitely with no cleanup path
- Storage costs grow unboundedly over time
- The `subscribeToNotifications` query (which filters `read == false`) is unaffected since notifications get marked read, but the collection grows without bound
- If a user clears notifications and reloads before they are marked read, they reappear

**Recommended fix:** Either:

- (a) Allow recipient to delete their own notifications: `allow delete: if isSignedIn() && resource.data.recipientUid == request.auth.uid;`
- (b) Add a TTL policy or scheduled Cloud Function to garbage-collect old notifications (e.g., > 30 days)

---

### BUG-2 (High): `dismissNotification` passes local ID to Firestore delete — ID mismatch

**Status:** Resolved. `AppNotification` now carries an optional `firestoreId` populated by `subscribeToNotifications` (`src/services/notifications.ts:236`), and `dismissNotification` resolves the local id to that value before calling `deleteNotification` (`src/context/NotificationContext.tsx:215-228`). `markRead`/`markAllRead` follow the same pattern. Locally-generated notifications without a Firestore counterpart (e.g. `GameNotificationWatcher` toasts) are simply dropped from local state with no server delete attempted.

**Files:**

- `src/context/NotificationContext.tsx:117` (ID generation: `n_${Date.now()}_${++idCounter}`)
- `src/context/NotificationContext.tsx:172-176` (`dismissNotification` calls `deleteNotification(id)`)

**Problem:** In-app notification IDs are generated client-side (`n_1713250000000_1`), but the Firestore notification documents have auto-generated IDs from `addDoc`. The `dismissNotification` function passes the local ID to `deleteNotification`, which targets a non-existent Firestore document.

Even if BUG-1 were fixed (deletes allowed), the delete would be a no-op — it targets a document path that doesn't exist.

**Impact:** Individual notification dismissal never cleans up the server-side document. Combined with BUG-1, notification docs are truly immortal.

**Recommended fix:** When `subscribeToNotifications` receives a notification, include the Firestore document ID in the `AppNotification` object so downstream code can reference the correct doc.

---

### SEC-1 (Medium): Rate-limit collection read rules are overly permissive

**Status:** Resolved. Both the `match /notification_limits` and `match /nudge_limits` blocks in `firestore.rules` now require `resource.data.senderUid == request.auth.uid` on read.

**Files:**

- `firestore.rules` `match /notification_limits` block — was `allow read: if isSignedIn();`
- `firestore.rules` `match /nudge_limits` block — was `allow read: if isSignedIn();`

**Problem:** Any authenticated user can read any other user's rate-limit documents. These docs contain `senderUid`, `gameId`, and timestamps — revealing which users are active in which games and when they last acted.

**Impact:** Information disclosure. An attacker can enumerate active games and player activity patterns by scanning these collections.

**Recommended fix:** Scope reads to the document owner:

```
allow read: if isSignedIn() && resource.data.senderUid == request.auth.uid;
```

---

### SEC-2 (Low): Nudge client-side cooldown key lacks user scoping

**Status:** Resolved. `src/services/nudge.ts:21` now uses ``const key = `nudge_${senderUid}_${gameId}`;``.

**File:** `src/services/nudge.ts:21`

**Problem:** The localStorage key is `nudge_${gameId}` with no user qualifier. If two users share a browser profile (e.g., shared device, testing), they share cooldown state.

**Impact:** Minimal in practice — the server-side rule (`nudge_limits`) is correctly keyed by `${senderUid}_${gameId}`. This is defense-in-depth only.

**Recommended fix:** Change key to `nudge_${senderUid}_${gameId}` for consistency with server-side.

---

### PERF-1 (Medium): No TTL or garbage collection for notification documents

**Status:** Partially resolved. The composite index for `recipientUid + read + createdAt` is declared in `firestore.indexes.json` (the `notifications` collection-group entry), and recipients can delete their own notifications (see BUG-1), so `dismissNotification` / `clearAll` now provide a manual cleanup path. A scheduled GC or Firestore TTL policy is still **not** in place — silent accumulation persists for users who never dismiss.

**Files:**

- `firestore.rules` `match /notifications` block (deletes were denied at audit time)
- No Cloud Function or TTL policy exists

**Problem:** Notification documents are write-once, mark-read, never-deleted. The collection grows monotonically.

**Impact:**

- Firestore storage costs increase linearly with app usage
- Collection-level queries become slower over time (though the indexed `recipientUid + read + createdAt` query mitigates this for active reads)
- No composite index defined in `firestore.indexes.json` for the `subscribeToNotifications` query (`recipientUid == X AND read == false ORDER BY createdAt DESC`) — Firestore may auto-create this, but it should be declared explicitly

**Recommended fix:**

- Add a scheduled Cloud Function to delete notifications older than 30 days
- Or configure Firestore TTL policy on the `createdAt` field
- Add the composite index to `firestore.indexes.json`

---

### BUG-3 (Critical): The declared push dispatcher does not exist — no OS push was ever delivered

**Status:** Resolved (2026-07-25).

**Files:**

- `firebase.json` — declared `"extensions": { "firestore-send-fcm": "firebase/firestore-send-fcm@0.1.16" }`
- `extensions/firestore-send-fcm.env` — configuration for a non-existent extension
- `src/services/pushDispatch.ts` — writes `/push_dispatch` docs
- `docs/CHARTER.md` §4.4 — described the extension as shipped

**Problem:** `firebase/firestore-send-fcm` is not a real Firebase Extension. `extensions.dev` returns HTTP 404 for it, while `firebase/firestore-send-email` at the identical URL shape returns 200; a registry search surfaces no FCM extension whatsoever. No local `extensions/firestore-send-fcm/` manifest directory had ever been generated (only the hand-written `.env`), and `functions/src/index.ts` exports only `onGameCompleted`. Nothing anywhere consumed `/push_dispatch`.

**Impact:**

- Every `/push_dispatch` doc was authored, validated against the create rule, rate-limited by its companion `/push_dispatch_limits` write — and then never read. Zero OS-level pushes were delivered for the entire period the extension was believed to be live.
- `/push_dispatch` accumulated without bound: its rules set `allow update, delete: if false` on the assumption the extension would delete-on-success, so there is no client-side cleanup path either.
- `firebase deploy` (without `--only`) would fail on the phantom extension block.

**Recommended fix:** Implemented as `api/cron/drain-push-dispatch.ts`, following the approved `api/cron/sweep-expired-turns.ts` pattern (bearer `CRON_SECRET`, `firebase-admin`, named `skatehubba` database), scheduled by `.github/workflows/drain-push-dispatch.yml` every five minutes. Delivery is at-least-once: a doc is deleted only after FCM accepts the send. Docs older than 24h are dropped unsent, preserving the old `TTL=86400` semantics. The `extensions` block and `.env` were removed.

**Operator follow-up:** the endpoint is unit-tested but has never run against production FCM. `VITE_FIREBASE_VAPID_KEY` must be set in the Vercel environment — without it `fcm.ts` logs `vapid_key_missing` and no device ever registers a token, so the queue stays empty regardless. The `CRON_SECRET` repo secret must match the Vercel value.

---

### BUG-4 (High): Nudges had no delivery path to an offline device

**Status:** Resolved (2026-07-25).

**Files:**

- `src/services/nudge.ts`
- `src/components/waiting/WaitingActions.tsx`
- `firestore.rules` — `/push_dispatch` and `/push_dispatch_limits` type allowlists

**Problem:** A nudge wrote only to `/nudges`, which is delivered exclusively by the recipient's `subscribeToNudges` listener. It therefore reached a user only if their tab was already open — precisely the user who does not need nudging. Meanwhile `WaitingActions.tsx` rendered "They'll get a push notification" on success, which was false.

**Impact:** The feature's entire purpose (poke an idle opponent) did not work, and the UI actively misinformed the sender.

**Recommended fix:** `sendNudge` now fires `dispatchPushNotification` with `type: "nudge"` after the batch commits, and `'nudge'` was added to the type allowlists on `/push_dispatch` and `/push_dispatch_limits`. It is deliberately NOT a valid `/notifications` type — the in-app feed schema is unchanged. The existing 1-hour `/nudge_limits` cooldown bounds abuse far tighter than the generic 5s dispatch cooldown, so no new amplification surface is opened. Copy updated to reflect the real ~5-minute latency.

---

### BUG-5 (High): Offline-delivered notifications never reached the bell, and stale ones toasted as new

**Status:** Resolved (2026-07-25).

**Files:**

- `src/services/notifications.ts` — `subscribeToNotifications`
- `src/context/NotificationContext.tsx` — new `hydrate`
- `src/components/GameNotificationWatcher.tsx`

**Problem:** Two coupled defects.

1. The bell was backed only by `skate_notifs_${uid}` in localStorage. `subscribeToNotifications` swallowed its entire first snapshot to avoid seed-toasting, and nothing else read those docs — so a challenge received while the app was closed left no in-app record, and a fresh device showed an empty bell despite unread docs on the server.
2. Because seeded docs are never toasted they are never marked read, so unread count grew monotonically across sessions. Past 10 unread, docs ranked 11+ sat outside the `read == false ORDER BY createdAt DESC LIMIT 10` window and were absent from the dedupe set; marking a toasted notification read pulled one in as an `added` change, which then toasted — with a chime — for a challenge from days ago.

**Impact:** Challenges received offline were invisible in-app; active users were periodically chimed for stale events.

**Recommended fix:** `subscribeToNotifications` gained an `onSeed` callback that hands the initial snapshot to a new silent `hydrate` on `NotificationContext` (no chime, no haptic, no toast, no `notifyKey` bump, idempotent across resubscribes). Toast eligibility now compares each added doc's `createdAt` against a monotonic high-water mark taken at seed time, so an older doc entering the window is a no-op regardless of how it got there. `subscribeToNudges` was analysed and deliberately left alone — `/nudges` docs are never updated or deleted, so its window cannot pull an old doc back in.

---

### BUG-6 (Medium): Nudge button poked the wrong player during judge phases

**Status:** Resolved (2026-07-25).

**Files:**

- `src/components/WaitingScreen.tsx`
- `src/components/waiting/useWaitingScreen.ts`

**Problem:** `useWaitingScreen` correctly rendered "Waiting on @judge" when `phase` was `disputable` or `setReview`, but the Nudge button was gated only on `game.status === "active" && !isJudge`, and `handleNudge` always targeted `opponentUid`. Status is still `active` during those phases, so the write succeeded.

**Impact:** The opponent — who was not holding anything up — got poked, and the sender's 1-hour cooldown for that game was consumed for nothing.

**Recommended fix:** `isJudgeTurn` is now exposed from the hook and folded into the button's visibility, so the control is hidden (not merely disabled) while the game is blocked on the judge.

---

### BUG-7 (Medium): Nudge cooldown was device-local and leaked raw Firebase error text

**Status:** Resolved (2026-07-25).

**Files:**

- `src/services/nudge.ts`
- `src/components/waiting/useWaitingScreen.ts`

**Problem:** `canNudge` read only `localStorage`. A nudge sent from another device left this device believing the button was available; the write was then rejected by the `/nudge_limits` rule and `useWaitingScreen` rendered `err.message` verbatim — "Missing or insufficient permissions." — to the user.

**Impact:** Confusing, alarming error copy on an entirely expected code path.

**Recommended fix:** New `getServerNudgeCooldownMs` reads the `/nudge_limits` anchor (the sender may read their own limit doc, so no new rules surface) and reconciles the button state after the initial localStorage-driven render. `sendNudge` now maps a `permission-denied` rejection to the same "You can only nudge once per hour per game" copy the local guard uses, and anything else to a generic message — raw Firebase strings never reach the UI.

---

### PERF-3 (Low): `deleteUserNotifications` issued an unbounded parallel delete burst

**Status:** Resolved (2026-07-25). The function fetched every matching doc and fired one `deleteDoc` per doc concurrently; with no TTL on `/notifications` (see PERF-1) a long-lived account made `clearAll` a thousand-write burst. Now paginates at the 500-op `writeBatch` limit until a short page ends the loop.

---

### PERF-2 (Low): FCM token array grows without proactive cleanup

**Status:** Resolved (2026-07-25). `api/cron/drain-push-dispatch.ts` removes any token FCM rejects with `messaging/registration-token-not-registered` or `messaging/invalid-registration-token` from BOTH `/pushTargets/{uid}.tokens` and `users/{uid}/private/profile.fcmTokens`, keeping the mirror and the canonical list in lockstep. Pruning is scoped to the dispatch doc's own `recipientUid`, and the `/push_dispatch` create rule's `tokens.hasOnly(<recipient mirror>)` check guarantees those tokens genuinely belong to that user — a crafted dispatch doc cannot make the drain mutate someone else's device list. Transient failure codes (quota, server-unavailable) never prune. The Problem/Impact/fix text below was written when the phantom `firestore-send-fcm` extension (BUG-3) was believed to be the live dispatcher; it is preserved for history — option (b) is effectively what shipped, implemented inside the drain endpoint itself.

**Files:**

- `src/services/fcm.ts:107` (private `fcmTokens` add via `arrayUnion`) and `:112` (cross-readable `/pushTargets/{uid}.tokens` mirror)
- `firestore.rules` `/pushTargets/{uid}` (cap of 10 tokens enforced server-side)
- `src/services/pushDispatch.ts` `MAX_TOKENS_PER_DISPATCH = 10` (per-dispatch fan-out cap, mirrored against the rule)
- (historical) Cloud Function `onNudgeCreated` previously cleaned tokens reactively on send failure — removed along with the rest of the `functions/` package; the drain endpoint (`api/cron/drain-push-dispatch.ts`) is the current sender and prunes dead tokens itself, per the Status above.

**Problem:** FCM tokens accumulate up to the per-user cap. Background push is now dispatched by the `firestore-send-fcm` extension via `/push_dispatch`, but no companion cleaner prunes tokens from `/pushTargets/{uid}` that the extension reports as invalid — the array sits at the cap and revoked devices stay in the rotation until the user clears their browser data or signs out.

**Impact:** A power user keeps the array full of stale tokens → the extension issues up to 10 FCM API calls per dispatch, most landing on `messaging/registration-token-not-registered` → increased latency and cost on every notification send (bounded but non-zero).

**Recommended fix:** Either (a) lower `MAX_TOKENS_PER_DISPATCH` and the matching `/pushTargets` rule cap (currently 10/10) once analytics confirm the typical active-device count, or (b) add a scheduled cleaner — triggered off the extension's delivery-result writes back to the dispatch doc — that prunes tokens reporting `messaging/registration-token-not-registered` from `/pushTargets/{uid}`. The two writers (`src/services/fcm.ts:107` for the private doc and `:112` for the mirror) must stay in lockstep with whatever pruner ships.

---

### ROBUST-1 (Medium): `subscribeToNotifications` marks notifications read immediately on arrival

**Status:** Resolved. `subscribeToNotifications` (`src/services/notifications.ts:220-253`) no longer calls `markNotificationRead` on arrival — it only forwards the notification (with `firestoreId`) to the caller. Read-marking is driven by user action via `markRead` / `markAllRead` in `NotificationContext`.

**File:** `src/services/notifications.ts:241`

**Problem:** `markNotificationRead(change.doc.id)` fires the instant a notification doc arrives in the snapshot, before the user has seen or interacted with the toast.

**Impact:**

- If the app crashes or the user navigates away before the toast renders, the notification is already marked read in Firestore — the user never sees it
- The `NotificationBell` unread count is driven by local state, not Firestore `read` status, masking this discrepancy
- On page reload, all recent notifications appear as "read" even if the user never saw them

**Recommended fix:** Defer `markNotificationRead` to when the user actually views the notification (e.g., when the toast renders or the bell dropdown opens), or accept this as intentional dedup behavior and document it.

---

### ROBUST-2 (Low): Service worker Firebase SDK version requires manual sync

**File:** `public/firebase-messaging-sw.js:7-8`

**Problem:** The service worker imports Firebase JS SDK from CDN at a hardcoded version (`12.11.0`). A comment warns to keep it in sync with `package.json`, but there's no automated check.

**Impact:** Version drift between the app's Firebase SDK and the service worker's SDK can cause silent messaging failures or API incompatibilities.

**Recommended fix:** The Vite build plugin already handles production builds. Add a CI check (or pre-commit hook) that verifies the CDN version matches the `firebase` version in `package.json`.

---

### ROBUST-3 (Resolved): `judge_invite` notification dispatch

**Status:** Resolved. `judge_invite` is on the same dispatch path as every other notification type:

- `src/services/games.create.ts:151` writes the `judge_invite` notification via `writeNotification`.
- `src/services/notifications.ts:102` — `writeNotification` unconditionally calls `dispatchPushNotification`, which writes to `/push_dispatch` for **every** type. The drain endpoint (`api/cron/drain-push-dispatch.ts`) consumes that collection and delivers FCM/APNS background push to the judge.
- `src/components/GameNotificationWatcher.tsx:19` — `fcmChimeMap` includes `judge_invite: "general"`, and `judge_invite` is in `FIRESTORE_HANDLED_TYPES` so the foreground watcher does not double-toast when the drain delivers the background push.

No further action required for the judge-invite path. Do not add a separate `/push_dispatch` write for `judge_invite` — the write already happens inside `writeNotification` and a duplicate would cause double background pushes.

---

## Test Coverage Assessment

| Area                                    | Test File                                        | Coverage                                                                                                                                                                                                                                                       | Verdict  |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `notifications.ts` service              | `notifications.test.ts` (995 lines)              | Write, rate-limit, read, delete, subscriptions, error paths                                                                                                                                                                                                    | **Good** |
| `fcm.ts` service                        | `fcm.test.ts` (447 lines)                        | Permission flow, token storage/removal, SW caching, error paths                                                                                                                                                                                                | **Good** |
| `nudge.ts` service                      | `nudge.test.ts` (257 lines)                      | Send, cooldown, localStorage                                                                                                                                                                                                                                   | **Good** |
| `NotificationContext`                   | `NotificationContext.test.tsx`                   | Provider state, toasts, persistence, auto-dismiss                                                                                                                                                                                                              | **Good** |
| `GameNotificationWatcher`               | `GameNotificationWatcher.test.tsx` (591 lines)   | Event detection, dedup, seeding, nudge/notification listeners                                                                                                                                                                                                  | **Good** |
| `NotificationBell`                      | `NotificationBell.test.tsx`                      | UI interactions, dropdown, dismiss                                                                                                                                                                                                                             | **Good** |
| `Toast`                                 | `Toast.test.tsx`                                 | Swipe-to-dismiss, auto-dismiss                                                                                                                                                                                                                                 | **Good** |
| `PushPermissionBanner`                  | `PushPermissionBanner.test.tsx`                  | Permission flow, dismiss, error states                                                                                                                                                                                                                         | **Good** |
| `ToastContainer`                        | `ToastContainer.test.tsx`                        | Container rendering                                                                                                                                                                                                                                            | **Good** |
| Firestore rules (`notification_limits`) | `notification-limits.rules.test.ts` (210 lines)  | Delete denial, create validation                                                                                                                                                                                                                               | **Good** |
| Firestore rules (`notifications`)       | `notifications-redteam.rules.test.ts`            | Recipient delete, sender immutability, cross-user reads — covered                                                                                                                                                                                              | **Good** |
| Firestore rules (`nudge_limits`)        | `nudges-redteam.rules.test.ts` (151 lines)       | Companion-write requirement, 1h cooldown gate, delete-denial — covered                                                                                                                                                                                         | **Good** |
| Firestore rules (`nudges`)              | `nudges-redteam.rules.test.ts` (151 lines)       | Create requires companion `nudge_limits` write; stale-cooldown bypass blocked — covered                                                                                                                                                                        | **Good** |
| Cloud Functions                         | `functions/src/*.test.ts` (stats close-out only) | Historical notification functions (`onNudgeCreated`, `onGameCreated`, `onGameUpdated`, `checkExpiredTurns`) were removed; the only remaining `functions/` code is the CI-allowlisted stats close-out, which has its own tests and touches no notification path | **N/A**  |

### Notable test gaps:

1. ~~**No Firestore rules tests for `/notifications`**~~ — covered by `rules-tests/notifications-redteam.rules.test.ts` and `notification-limits.rules.test.ts` (added after this audit).
2. ~~**No Firestore rules tests for `/nudges` or `/nudge_limits`**~~ — covered by `rules-tests/nudges-redteam.rules.test.ts`: companion `nudge_limits` write requirement, the 1-hour cooldown gate (including the stale-cooldown bypass), and limit-doc delete-denial are exercised at the rules level.
3. **Cloud Functions limited to the stats close-out** — the historical notification `functions/` package remains removed. Background push (FCM) is delivered by the drain endpoint (`api/cron/drain-push-dispatch.ts`, on a five-minute GitHub Actions schedule) consuming `/push_dispatch`. Billing alerts previously implemented in `functions/` are no longer deployed; expired turns are handled by client-side `forfeitExpiredTurn` plus the `api/cron/sweep-expired-turns.ts` sweep (see `docs/CHARTER.md` §9.2). Win/loss stat writes moved server-side to the maintainer-approved stats close-out function (`functions/src/applyGameStats.ts`) — none of the notification paths audited here involve it.

---

## Architecture Assessment

| Aspect                                                       | Verdict    | Notes                                                                                 |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| Defense-in-depth (client + server rate limiting)             | **Strong** | Both layers enforce cooldowns independently                                           |
| Deduplication (Firestore vs FCM)                             | **Strong** | `FIRESTORE_HANDLED_TYPES` set prevents double-toasting                                |
| Initial-snapshot suppression                                 | **Strong** | Both `subscribeToNudges` and `subscribeToNotifications` correctly skip seed snapshots |
| Bounded memory (tracked IDs capped at 50)                    | **Good**   | Prevents unbounded Set growth in long-lived sessions                                  |
| Best-effort pattern (notifications never block game actions) | **Good**   | All notification writes are fire-and-forget with catch                                |
| Push notification deep-linking                               | **Good**   | Service worker → `postMessage` → `CustomEvent` → App.tsx works end-to-end             |
| Security rules field validation                              | **Good**   | Type enum, participant checks, field immutability on update                           |
| Separation of concerns                                       | **Good**   | Services → Context → Components layering is clean                                     |

---

## Summary

| #        | Severity   | Finding                                                                    | Type        | Status                                                                                                           |
| -------- | ---------- | -------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| BUG-1    | **High**   | Client delete operations always fail (rules deny, docs accumulate forever) | Bug         | Resolved (recipient delete allowed)                                                                              |
| BUG-2    | **High**   | `dismissNotification` passes local ID, not Firestore doc ID                | Bug         | Resolved (`firestoreId` plumbed through)                                                                         |
| SEC-1    | **Medium** | Rate-limit collection reads open to all authenticated users                | Security    | Resolved (reads scoped to `senderUid`)                                                                           |
| SEC-2    | **Low**    | Nudge localStorage key not scoped to user                                  | Security    | Resolved                                                                                                         |
| PERF-1   | **Medium** | No TTL or GC for notification documents + missing composite index          | Performance | Partially resolved (index added; no scheduled GC)                                                                |
| PERF-2   | **Low**    | FCM token array grows without proactive cleanup                            | Performance | Resolved (drain endpoint prunes dead tokens on send)                                                             |
| ROBUST-1 | **Medium** | Notifications marked read before user sees them                            | Robustness  | Resolved (read-marking is user-driven)                                                                           |
| ROBUST-2 | **Low**    | Service worker Firebase SDK version manually synced                        | Robustness  | Open                                                                                                             |
| ROBUST-3 | **Low**    | `judge_invite` has no dedicated chime or FCM push path                     | Robustness  | Resolved (chime mapped; push flows through `writeNotification` — no separate dispatch write needed)              |
| TEST-1   | **Medium** | No Firestore rules tests for `/notifications`, `/nudges`, `/nudge_limits`  | Coverage    | Resolved (all three covered — see test gaps 1–2)                                                                 |
| TEST-2   | **Medium** | No Cloud Function unit tests                                               | Coverage    | N/A for notifications (only `functions/` code is the CI-allowlisted stats close-out, outside this audit's paths) |
