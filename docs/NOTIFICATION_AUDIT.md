# Notification System Audit

**Date:** 2026-04-16
**Scope:** All notification paths — Firestore rules, Cloud Functions, client services, UI components, push (FCM), test coverage

---

## System Overview

The notification system has three delivery channels:

1. **Firestore real-time** — Client writes to `/notifications`, recipient's `onSnapshot` listener surfaces in-app toasts
2. **FCM push** — Historically served by Cloud Functions (`onGameUpdated`, `onGameCreated`, `onNudgeCreated`); those were removed with the `functions/` package. FCM tokens are still collected client-side (`src/services/fcm.ts`), but no sender exists in this repo — background push is effectively disabled until an external sender is wired up.
3. **Client-side game watchers** — `GameNotificationWatcher` detects game state changes from the existing games `onSnapshot` and fires local toasts

Deduplication logic in `GameNotificationWatcher` suppresses FCM foreground messages for types already covered by Firestore watchers (retained for when push is re-enabled).

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

- `src/services/fcm.ts:75` (tokens added via `arrayUnion`)
- (historical) Cloud Function `onNudgeCreated` previously cleaned tokens reactively on send failure — removed along with the rest of the `functions/` package; no replacement cleaner currently runs.

**Problem:** FCM tokens accumulate indefinitely. With the Cloud Functions removed, no server-side cleanup runs on send failure either — push is effectively disabled until a replacement backend exists.

**Impact:** A power user accumulates stale tokens → `sendEachForMulticast` makes unnecessary FCM API calls → increased latency and cost on every notification send.

**Recommended fix:** Add a periodic Cloud Function (e.g., weekly) that validates stored tokens via the FCM API and removes invalid ones, or cap the array at a reasonable size (e.g., 5 tokens per user).

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

### ROBUST-3 (Low): `judge_invite` notification has no watcher-side handling

**Status:** Resolved (chime mapping). `fcmChimeMap` now includes `judge_invite: "general"` (`src/components/GameNotificationWatcher.tsx:19`), and `judge_invite` is in `FIRESTORE_HANDLED_TYPES` to avoid double-toasting if FCM is ever re-enabled. The dedicated FCM push path is moot until an external sender exists.

**Files:**

- `src/services/games.ts:319-327` (writes `judge_invite` notification)
- `src/components/GameNotificationWatcher.tsx` (no handler for judge invite events)

**Problem:** When a game is created with a judge, `writeNotification` sends a `judge_invite` type notification. The `subscribeToNotifications` listener in `GameNotificationWatcher` does receive this (it listens to all unread notifications), but there's no specific detection logic or chime mapping for `judge_invite` in the watcher.

**Impact:** The notification arrives and displays correctly via the generic `subscribeToNotifications` path with a "general" chime. This is functional but inconsistent — all other notification types have dedicated chime mappings in `fcmChimeMap`. (Historically, the removed Cloud Functions also didn't send an FCM push for judge invites — only `onGameCreated` pushed to player2, not the judge. With FCM senders gone entirely, this is moot until push is re-enabled.)

**Recommended fix:**

- Add `judge_invite: "general"` (or a dedicated chime) to `fcmChimeMap`
- Consider adding an FCM push path for judge invites in the Cloud Function so judges get notified even when the app is closed

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
| Firestore rules (`nudge_limits`)        | _None_                                          | No rules-level integration tests                                                                                                                        | **Gap**  |
| Firestore rules (`nudges`)              | _None_                                          | No rules-level integration tests                                                                                                                        | **Gap**  |
| Cloud Functions                         | _None in repo_                                  | Historical `onNudgeCreated`, `onGameCreated`, `onGameUpdated`, `checkExpiredTurns` were removed with the `functions/` package — no current code to test | **N/A**  |

### Notable test gaps:

1. ~~**No Firestore rules tests for `/notifications`**~~ — covered by `rules-tests/notifications-redteam.rules.test.ts` and `notification-limits.rules.test.ts` (added after this audit).
2. **No Firestore rules tests for `/nudges` or `/nudge_limits`** — game-participant validation, active-game check, and cooldown enforcement are still untested at the rules level.
3. **No Cloud Functions at all** — the `functions/` package was removed from this repo. Push notifications (FCM), scheduled forfeit enforcement, and billing alerts previously implemented there are no longer deployed. Client-side `forfeitExpiredTurn` and `updatePlayerStats` continue to run on game completion.

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

| #        | Severity   | Finding                                                                    | Type        | Status                                                        |
| -------- | ---------- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| BUG-1    | **High**   | Client delete operations always fail (rules deny, docs accumulate forever) | Bug         | Resolved (recipient delete allowed)                           |
| BUG-2    | **High**   | `dismissNotification` passes local ID, not Firestore doc ID                | Bug         | Resolved (`firestoreId` plumbed through)                      |
| SEC-1    | **Medium** | Rate-limit collection reads open to all authenticated users                | Security    | Resolved (reads scoped to `senderUid`)                        |
| SEC-2    | **Low**    | Nudge localStorage key not scoped to user                                  | Security    | Resolved                                                      |
| PERF-1   | **Medium** | No TTL or GC for notification documents + missing composite index          | Performance | Partially resolved (index added; no scheduled GC)             |
| PERF-2   | **Low**    | FCM token array grows without proactive cleanup                            | Performance | Open (no Cloud Functions to run cleanup)                      |
| ROBUST-1 | **Medium** | Notifications marked read before user sees them                            | Robustness  | Resolved (read-marking is user-driven)                        |
| ROBUST-2 | **Low**    | Service worker Firebase SDK version manually synced                        | Robustness  | Open                                                          |
| ROBUST-3 | **Low**    | `judge_invite` has no dedicated chime or FCM push path                     | Robustness  | Resolved (chime mapping); FCM push moot until sender re-added |
| TEST-1   | **Medium** | No Firestore rules tests for `/notifications`, `/nudges`, `/nudge_limits`  | Coverage    | Partially resolved (`/notifications` covered)                 |
| TEST-2   | **Medium** | No Cloud Function unit tests                                               | Coverage    | N/A (no `functions/` package in repo)                         |
