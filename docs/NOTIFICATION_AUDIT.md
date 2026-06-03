# Notification System Audit

**Date:** 2026-04-16
**Last updated:** 2026-05-20 (reconciled with shipped `firestore-send-fcm` dispatcher)
**Scope:** All notification paths — Firestore rules, the `firestore-send-fcm` extension dispatcher, client services, UI components, push (FCM), test coverage

---

## System Overview

The notification system has three delivery channels:

1. **Firestore real-time** — Client writes to `/notifications`, recipient's `onSnapshot` listener surfaces in-app toasts
2. **FCM push** — Historically served by application-authored Cloud Functions (`onGameUpdated`, `onGameCreated`, `onNudgeCreated`); those were removed with the `functions/` package. Background push is now dispatched by the `firestore-send-fcm` Firebase Extension (managed Cloud Run worker, not authored Cloud Functions). Clients collect FCM tokens via `src/services/fcm.ts` and write dispatch jobs to `/push_dispatch` via `src/services/pushDispatch.ts`; the extension consumes that collection and sends FCM/APNS. See `extensions/firestore-send-fcm.env` for configuration and `firestore.rules` for the create contract.
3. **Client-side game watchers** — `GameNotificationWatcher` detects game state changes from the existing games `onSnapshot` and fires local toasts

Deduplication logic in `GameNotificationWatcher` suppresses FCM foreground messages for types already covered by Firestore watchers.

---

## Findings

### BUG-1 (High): Client delete operations always fail — Firestore rules deny all deletes

**Status:** Resolved. `firestore.rules:984-986` now allows `delete` when `resource.data.recipientUid == request.auth.uid`. The original finding is preserved below for history.

**Files:**

- `src/services/notifications.ts:133-135` (`deleteNotification`)
- `src/services/notifications.ts:140-145` (`deleteUserNotifications`)
- `src/context/NotificationContext.tsx:172-176` (`dismissNotification`)
- `src/context/NotificationContext.tsx:162-169` (`clearAll`)
- `firestore.rules:788` (`allow delete: if false`)

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

**Status:** Resolved. Both `notification_limits` (`firestore.rules:993-994`) and `nudge_limits` (`firestore.rules:1073-1074`) now require `resource.data.senderUid == request.auth.uid` on read.

**Files:**

- `firestore.rules:794` — `notification_limits`: `allow read: if isSignedIn();`
- `firestore.rules:854` — `nudge_limits`: `allow read: if isSignedIn();`

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

**Status:** Partially resolved. The composite index for `recipientUid + read + createdAt` is now declared in `firestore.indexes.json:20-28`, and recipients can delete their own notifications (see BUG-1), so `dismissNotification` / `clearAll` now provide a manual cleanup path. A scheduled GC or Firestore TTL policy is still **not** in place — silent accumulation persists for users who never dismiss.

**Files:**

- `firestore.rules:788` (deletes denied)
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

### PERF-2 (Low): FCM token array grows without proactive cleanup

**Files:**

- `src/services/fcm.ts:107` (private `fcmTokens` add via `arrayUnion`) and `:112` (cross-readable `/pushTargets/{uid}.tokens` mirror)
- `firestore.rules` `/pushTargets/{uid}` (cap of 10 tokens enforced server-side)
- `src/services/pushDispatch.ts` `MAX_TOKENS_PER_DISPATCH = 10` (per-dispatch fan-out cap, mirrored against the rule)
- (historical) Cloud Function `onNudgeCreated` previously cleaned tokens reactively on send failure — removed along with the rest of the `functions/` package; the `firestore-send-fcm` extension is the current sender but no token-pruning cleaner runs against its delivery results.

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
- `src/services/notifications.ts:102` — `writeNotification` unconditionally calls `dispatchPushNotification`, which writes to `/push_dispatch` for **every** type. The `firestore-send-fcm` extension consumes that collection and delivers FCM/APNS background push to the judge.
- `src/components/GameNotificationWatcher.tsx:19` — `fcmChimeMap` includes `judge_invite: "general"`, and `judge_invite` is in `FIRESTORE_HANDLED_TYPES` so the foreground watcher does not double-toast when the extension delivers the background push.

No further action required for the judge-invite path. Do not add a separate `/push_dispatch` write for `judge_invite` — the write already happens inside `writeNotification` and a duplicate would cause double background pushes.

---

## Test Coverage Assessment

| Area                                    | Test File                                       | Coverage                                                                                                                                                | Verdict  |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `notifications.ts` service              | `notifications.test.ts` (614 lines)             | Write, rate-limit, read, delete, subscriptions, error paths                                                                                             | **Good** |
| `fcm.ts` service                        | `fcm.test.ts` (174 lines)                       | Permission flow, token storage/removal, SW caching, error paths                                                                                         | **Good** |
| `nudge.ts` service                      | `nudge.test.ts` (93 lines)                      | Send, cooldown, localStorage                                                                                                                            | **Good** |
| `NotificationContext`                   | `NotificationContext.test.tsx`                  | Provider state, toasts, persistence, auto-dismiss                                                                                                       | **Good** |
| `GameNotificationWatcher`               | `GameNotificationWatcher.test.tsx` (696 lines)  | Event detection, dedup, seeding, nudge/notification listeners                                                                                           | **Good** |
| `NotificationBell`                      | `NotificationBell.test.tsx`                     | UI interactions, dropdown, dismiss                                                                                                                      | **Good** |
| `Toast`                                 | `Toast.test.tsx`                                | Swipe-to-dismiss, auto-dismiss                                                                                                                          | **Good** |
| `PushPermissionBanner`                  | `PushPermissionBanner.test.tsx`                 | Permission flow, dismiss, error states                                                                                                                  | **Good** |
| `ToastContainer`                        | `ToastContainer.test.tsx`                       | Container rendering                                                                                                                                     | **Good** |
| Firestore rules (`notification_limits`) | `notification-limits.rules.test.ts` (119 lines) | Delete denial, create validation                                                                                                                        | **Good** |
| Firestore rules (`notifications`)       | `notifications-redteam.rules.test.ts`           | Recipient delete, sender immutability, cross-user reads — covered                                                                                       | **Good** |
| Firestore rules (`nudge_limits`)        | `nudges-redteam.rules.test.ts` (145 lines)      | Companion-write requirement, 1h cooldown gate, delete-denial — covered                                                                                  | **Good** |
| Firestore rules (`nudges`)              | `nudges-redteam.rules.test.ts` (145 lines)      | Create requires companion `nudge_limits` write; stale-cooldown bypass blocked — covered                                                                 | **Good** |
| Cloud Functions                         | _None in repo_                                  | Historical `onNudgeCreated`, `onGameCreated`, `onGameUpdated`, `checkExpiredTurns` were removed with the `functions/` package — no current code to test | **N/A**  |

### Notable test gaps:

1. ~~**No Firestore rules tests for `/notifications`**~~ — covered by `rules-tests/notifications-redteam.rules.test.ts` and `notification-limits.rules.test.ts` (added after this audit).
2. ~~**No Firestore rules tests for `/nudges` or `/nudge_limits`**~~ — covered by `rules-tests/nudges-redteam.rules.test.ts`: companion `nudge_limits` write requirement, the 1-hour cooldown gate (including the stale-cooldown bypass), and limit-doc delete-denial are exercised at the rules level.
3. **No application-authored Cloud Functions** — the `functions/` package was removed from this repo. Background push (FCM) is now delivered by the `firestore-send-fcm` Firebase Extension's managed Cloud Run worker consuming `/push_dispatch`. Scheduled forfeit enforcement and billing alerts previously implemented in `functions/` are no longer deployed; client-side `forfeitExpiredTurn` and `updatePlayerStats` continue to run on game completion (auto-forfeit gap tracked in `docs/CHARTER.md` §9.2).

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

| #        | Severity   | Finding                                                                    | Type        | Status                                                                 |
| -------- | ---------- | -------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| BUG-1    | **High**   | Client delete operations always fail (rules deny, docs accumulate forever) | Bug         | Resolved (recipient delete allowed)                                    |
| BUG-2    | **High**   | `dismissNotification` passes local ID, not Firestore doc ID                | Bug         | Resolved (`firestoreId` plumbed through)                               |
| SEC-1    | **Medium** | Rate-limit collection reads open to all authenticated users                | Security    | Resolved (reads scoped to `senderUid`)                                 |
| SEC-2    | **Low**    | Nudge localStorage key not scoped to user                                  | Security    | Resolved                                                               |
| PERF-1   | **Medium** | No TTL or GC for notification documents + missing composite index          | Performance | Partially resolved (index added; no scheduled GC)                      |
| PERF-2   | **Low**    | FCM token array grows without proactive cleanup                            | Performance | Open (extension delivers push; no token-pruning cleaner runs)          |
| ROBUST-1 | **Medium** | Notifications marked read before user sees them                            | Robustness  | Resolved (read-marking is user-driven)                                 |
| ROBUST-2 | **Low**    | Service worker Firebase SDK version manually synced                        | Robustness  | Open                                                                   |
| ROBUST-3 | **Low**    | `judge_invite` has no dedicated chime or FCM push path                     | Robustness  | Resolved (chime mapping); judge-role `/push_dispatch` write still TODO |
| TEST-1   | **Medium** | No Firestore rules tests for `/notifications`, `/nudges`, `/nudge_limits`  | Coverage    | Partially resolved (`/notifications` covered)                          |
| TEST-2   | **Medium** | No Cloud Function unit tests                                               | Coverage    | N/A (no `functions/` package; extension is managed)                    |
