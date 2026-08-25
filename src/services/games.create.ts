import { doc, getDoc, setDoc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import {
  normalizeTrickCategory,
  normalizeCustomRules,
  trickCategoryHeadline,
  CUSTOM_CATEGORY_ID,
} from "../constants/trickCategories";
import { addBreadcrumb } from "../lib/sentry";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger, metrics } from "./logger";
import { writeNotification } from "./notifications";
import {
  toGameDoc,
  normalizeSpotId,
  type GameStatus,
  type GamePhase,
  type JudgeStatus,
  type CreateGameOptions,
} from "./games.mappers";
import { TURN_DURATION_MS, gamesRef, checkGameCreationRate, recordGameCreation } from "./games.turns";

/* ────────────────────────────────────────────
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

/**
 * Create a new SKATE game between two players. Returns the new game ID.
 *
 * Preconditions / throws:
 *   • caller must be `challengerUid` (enforced by Firestore rules)
 *   • challenger email must be verified (rules)
 *   • rate limited: one game per `GAME_CREATE_COOLDOWN_MS` per client
 *   • if `judgeUid` is supplied, `judgeUsername` MUST also be supplied and
 *     `judgeUid` MUST differ from both players
 *
 * The challenger is assigned as `player1` and sets first.
 */
export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
  options: CreateGameOptions = {},
): Promise<string> {
  checkGameCreationRate();

  const {
    challengerIsVerifiedPro,
    opponentIsVerifiedPro,
    spotId,
    trickCategory,
    customRules,
    judgeUid,
    judgeUsername,
  } = options;

  // Defense-in-depth: drop any spotId that doesn't look like a UUID before
  // it reaches Firestore. Keeps the data model clean even if an upstream
  // caller forgets to validate or a shared URL has a stale/garbled value.
  const safeSpotId = normalizeSpotId(spotId);

  // Normalize the category, then keep custom-rules text only for custom games —
  // sanitized (trim/strip/cap) at this boundary so untrusted input never
  // reaches Firestore raw. Any non-custom category stores null.
  const safeCategory = normalizeTrickCategory(trickCategory);
  const safeCustomRules = safeCategory === CUSTOM_CATEGORY_ID ? normalizeCustomRules(customRules) : null;

  // Judge validation: if a judge is nominated, they must be a distinct third
  // party. Silently dropping an invalid nomination lets the game fall back to
  // honor system rather than rejecting the whole creation — UI-level guards
  // surface the "can't judge yourself / your opponent" message upstream.
  const hasValidJudge =
    typeof judgeUid === "string" &&
    judgeUid.length > 0 &&
    judgeUid !== challengerUid &&
    judgeUid !== opponentUid &&
    typeof judgeUsername === "string" &&
    judgeUsername.length > 0;

  // Security (impersonation defense): Firestore rules bind the game doc's
  // `player1Username` to the challenger's authoritative `users/{uid}.username`.
  // Read it from the caller's OWN profile rather than trusting the passed
  // display string, so an honest create always stamps the real handle and can
  // never be abused to impersonate someone else. `challengerUid` is the
  // authenticated caller (rules enforce caller === player1Uid), so this reads
  // the caller's own always-readable doc. Fall back to the supplied value only
  // when the profile has no username yet — a state the rules reject anyway, so
  // no spoofed value can ever satisfy the write.
  const challengerProfileSnap = await withRetry(() => getDoc(doc(requireDb(), "users", challengerUid)));
  const challengerProfile = challengerProfileSnap.exists()
    ? (challengerProfileSnap.data() as { username?: string })
    : null;
  const authoritativeChallengerUsername =
    typeof challengerProfile?.username === "string" && challengerProfile.username.length > 0
      ? challengerProfile.username
      : challengerUsername;

  const deadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);

  const gameData = {
    player1Uid: challengerUid,
    player2Uid: opponentUid,
    player1Username: authoritativeChallengerUsername,
    player2Username: opponentUsername,
    p1Letters: 0,
    p2Letters: 0,
    status: "active" as GameStatus,
    // Challenger sets first trick
    currentTurn: challengerUid,
    phase: "setting" as GamePhase,
    currentSetter: challengerUid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: deadline,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    // Always write an explicit trick category (default "any") — same rationale
    // as the explicit judge nulls: keeps the schema uniform across all docs.
    trickCategory: safeCategory,
    // Explicit null for non-custom games keeps the schema uniform and lets the
    // rules pin it immutable without presence gymnastics.
    customRules: safeCustomRules,
    // Judge fields default to null (honor system). Keeping explicit nulls —
    // rather than omitting — makes security rule checks easier and keeps
    // the schema uniform across all game docs.
    judgeId: hasValidJudge ? judgeUid : null,
    judgeUsername: hasValidJudge ? judgeUsername : null,
    judgeStatus: (hasValidJudge ? "pending" : null) as JudgeStatus,
    judgeReviewFor: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(challengerIsVerifiedPro && { player1IsVerifiedPro: true }),
    ...(opponentIsVerifiedPro && { player2IsVerifiedPro: true }),
    ...(safeSpotId && { spotId: safeSpotId }),
  };

  // F10: Force-refresh the ID token before the create write. Firestore rules
  // gate game creation on `request.auth.token.email_verified == true`, but the
  // cached JWT may not yet reflect a freshly-verified email — without this the
  // user hits a rules rejection in the brief staleness window after clicking
  // the verification link. Best-effort: a refresh failure must NOT block the
  // create. The server-side rule still fires and surfaces a clean error path.
  const currentUser = requireAuth().currentUser;
  if (currentUser) {
    try {
      await currentUser.getIdToken(/* forceRefresh= */ true);
    } catch {
      addBreadcrumb({
        category: "auth",
        message: "forced ID token refresh failed before createGame",
        level: "warning",
      });
    }
  }

  // Generate the game ID client-side so a retry after a perceived network
  // failure re-sends the exact same write (idempotent at a fixed ID) instead
  // of creating a second game. addDoc would be non-deterministic here.
  const newGameId = doc(gamesRef()).id;
  await withRetry(() => setDoc(doc(gamesRef(), newGameId), gameData));
  recordGameCreation();
  metrics.gameCreated(newGameId, challengerUid);
  // Update rate-limit timestamp on user profile (best effort — game is already created).
  setDoc(doc(requireDb(), "users", challengerUid), { lastGameCreatedAt: serverTimestamp() }, { merge: true }).catch(
    (err) => {
      logger.warn("rate_limit_timestamp_write_failed", {
        uid: challengerUid,
        error: parseFirebaseError(err),
      });
    },
  );
  // Notify opponent about the new challenge.
  //
  // AWAITED (and the push dispatch with it). It cannot ride the game write's
  // transaction: the /notifications create rule resolves the recipient against
  // `get(/games/{gameId})` — a PRE-commit read — so an in-tx notification for a
  // game that doesn't exist yet is denied outright. The next best guarantee is
  // to not return until both the notification batch and the /push_dispatch doc
  // have committed, because the caller navigates on return and an unawaited
  // write dies with the page. api/cron/sweep-expired-turns.ts carries a
  // server-side reconcile pass as the backstop for the residual window.
  //
  // Append the agreed constraint ("— Flat Bar", or the custom rules text) so
  // the invite states the game up front; "any"/legacy games announce nothing.
  const headline = trickCategoryHeadline(safeCategory, safeCustomRules);
  const pending: Array<Promise<void>> = [
    writeNotification(
      {
        senderUid: challengerUid,
        recipientUid: opponentUid,
        type: "new_challenge",
        title: "New Challenge!",
        body: headline
          ? `@${authoritativeChallengerUsername} challenged you to S.K.A.T.E. — ${headline}`
          : `@${authoritativeChallengerUsername} challenged you to S.K.A.T.E.`,
        gameId: newGameId,
      },
      { awaitPush: true },
    ),
  ];
  // Notify the referee (if any) that they've been nominated (best-effort).
  // The notification `type` code stays "judge_invite" for schema stability —
  // existing docs and any listeners keyed on it must keep working. Only the
  // user-visible title copy is renamed.
  if (hasValidJudge) {
    pending.push(
      writeNotification(
        {
          senderUid: challengerUid,
          recipientUid: judgeUid,
          type: "judge_invite",
          title: "You've been asked to referee",
          body: `@${authoritativeChallengerUsername} vs @${opponentUsername} — accept to rule on disputes`,
          gameId: newGameId,
        },
        { awaitPush: true },
      ),
    );
  }
  // Concurrent, not sequential: the two notifications are independent writes to
  // different recipients, and the caller navigates on return — serializing them
  // doubled the perceived create latency for judged games. Still fully AWAITED
  // (writeNotification never rejects), so the delivery guarantee is unchanged:
  // both batches and both /push_dispatch docs have committed before we return.
  await Promise.all(pending);
  return newGameId;
}

/* ────────────────────────────────────────────
 * Judge invite lifecycle
 *
 * Judge nomination is OPTIONAL — a game can be played on the honor system
 * with no judge at all. When a judge is nominated, the invite stays in
 * `pending` until the judge accepts, declines, or the 24h window elapses.
 *
 * While pending: game operates as honor system (no dispute / no BS calls)
 * Accepted:      dispute & BS flows route to the judge
 * Declined:      permanent honor system (judgeId preserved for history,
 *                judgeStatus flipped so rules know not to route to them)
 * ──────────────────────────────────────────── */

/**
 * Accept a pending referee invite. Must be called by the nominated referee;
 * rejects if the game is over, has no referee, or the invite is no longer
 * pending (already accepted / declined / 24h expired).
 */
export async function acceptJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "accepted",
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Decline a pending referee invite. The game continues on the honor system;
 * `judgeId` is preserved for history but `judgeStatus` flips to `declined`
 * so BS / dispute flows route back to honor-system behavior.
 */
export async function declineJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "declined",
      updatedAt: serverTimestamp(),
    });
  });
}
