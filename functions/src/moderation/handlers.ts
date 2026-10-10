import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { VIDEO_API_POLL_MS, VIDEO_API_TIMEOUT_MS } from "./config.js";
import { adminPatch, shouldApplyUploadDecision, shouldAutoHideClip, type SaveGuard } from "./patches.js";
import { runReportModeration } from "./runReport.js";
import { runUploadModeration } from "./runUpload.js";
import { captureModerationFailure } from "./sentry.js";
import { reconcileClipVideo, type ClipObjectStore } from "./publish.js";
import { notificationCopy, statementIdFor, type StatementOfReasons } from "./statement.js";
import { annotateStoredVideo } from "./video.js";

interface HandlerOptions {
  db: Firestore;
  enabled: boolean;
  sentryDsn: string;
  /** Copies the video onto the approved path, or back off it. Omitted in tests. */
  media?: ClipObjectStore;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

async function saveClip(
  db: Firestore,
  clipId: string,
  patch: Record<string, unknown>,
  guard: SaveGuard,
): Promise<boolean> {
  const ref = db.collection("clips").doc(clipId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    const allowed =
      guard === "pending-only"
        ? shouldApplyUploadDecision(data.moderation)
        : guard === "hide-if-open"
          ? shouldAutoHideClip(data)
          : data.source === "user";
    if (!allowed) return false;
    tx.update(ref, { ...patch, moderationUpdatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

async function writeRestrictionStatement(
  db: Firestore,
  clipId: string,
  ownerUid: string,
  statement: StatementOfReasons,
): Promise<void> {
  if (statement.decision !== "rejected" && statement.decision !== "removed" && statement.decision !== "review") return;
  const statementId = statementIdFor(clipId);
  await db
    .collection("moderationStatements")
    .doc(statementId)
    .set({
      subjectUid: ownerUid,
      reportId: statementId,
      action: "content_restricted",
      reason: statement.grounds.slice(0, 64),
      explanation: statement.statement.slice(0, 1000),
      contentRef: clipId.slice(0, 128),
      createdBy: "moderation",
      createdAt: FieldValue.serverTimestamp(),
    });
}

async function syncClipMedia(
  options: HandlerOptions,
  clipId: string,
  ownerUid: unknown,
  videoUrl: unknown,
  moderation: unknown,
): Promise<void> {
  if (!options.media) return;
  if (typeof ownerUid !== "string" || ownerUid.length === 0) return;
  if (typeof videoUrl !== "string" || videoUrl.length === 0) return;
  if (moderation !== "approved" && moderation !== "rejected" && moderation !== "removed" && moderation !== "review") {
    return;
  }
  try {
    const next = await reconcileClipVideo(options.media, {
      ownerUid,
      videoUrl,
      visible: moderation === "approved",
    });
    if (next && next !== videoUrl) {
      await options.db.collection("clips").doc(clipId).update({ videoUrl: next });
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "clip_media_sync_failed",
        clipId,
        error: error instanceof Error ? error.message : "failed",
      }),
    );
  }
}

async function notifyOwner(
  db: Firestore,
  clipId: string,
  ownerUid: string,
  statement: StatementOfReasons,
): Promise<void> {
  await writeRestrictionStatement(db, clipId, ownerUid, statement);
  const copy = notificationCopy(statement);
  await db.collection("notifications").doc(`moderation_${clipId}_${statement.decision}`).set({
    senderUid: "moderation",
    recipientUid: ownerUid,
    type: "clip_moderation",
    title: copy.title,
    body: copy.body,
    gameId: "",
    clipId,
    appealPath: statement.appealPath,
    statementOfReasons: statement,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function handleClipCreated(options: HandlerOptions, clipId: string, raw: unknown): Promise<void> {
  const clip = asRecord(raw);
  await runUploadModeration({
    enabled: options.enabled,
    clipId,
    clip,
    annotate: (gcsUri) => annotateStoredVideo(gcsUri, { timeoutMs: VIDEO_API_TIMEOUT_MS, pollMs: VIDEO_API_POLL_MS }),
    save: async (patch, guard) => {
      const applied = await saveClip(options.db, clipId, patch, guard);
      if (applied) await syncClipMedia(options, clipId, clip?.playerUid, clip?.videoUrl, patch.moderation);
      return applied;
    },
    notify: (ownerUid, statement) => notifyOwner(options.db, clipId, ownerUid, statement),
    capture: (error, extra) => captureModerationFailure(options.sentryDsn, error, extra).then(() => undefined),
  });
}

export async function handleClipReport(options: HandlerOptions, raw: unknown, nowMs: number): Promise<void> {
  const report = asRecord(raw);
  const clipId = typeof report?.clipId === "string" ? report.clipId : "";
  const reason = typeof report?.reason === "string" ? report.reason : "";
  let loaded: Record<string, unknown> | null = null;
  await runReportModeration({
    enabled: options.enabled,
    clipId,
    reason,
    nowMs,
    loadClip: async () => {
      if (clipId.length === 0) return null;
      const snap = await options.db.collection("clips").doc(clipId).get();
      loaded = snap.exists ? (snap.data() ?? null) : null;
      return loaded;
    },
    loadReports: async () => {
      if (clipId.length === 0) return [];
      const snap = await options.db.collection("reports").where("clipId", "==", clipId).get();
      return snap.docs.map((doc) => {
        const data = doc.data();
        return {
          reporterUid: typeof data.reporterUid === "string" ? data.reporterUid : "",
          reason: typeof data.reason === "string" ? data.reason : "",
        };
      });
    },
    loadCreatedAt: async (uid) => {
      const snap = await options.db.collection("users").doc(uid).get();
      const created = snap.get("createdAt") as { toMillis?: () => number } | undefined;
      if (!created || typeof created.toMillis !== "function") return null;
      const ms = created.toMillis();
      return Number.isFinite(ms) ? ms : null;
    },
    save: async (patch, guard) => {
      const applied = await saveClip(options.db, clipId, patch, guard);
      if (applied) await syncClipMedia(options, clipId, loaded?.playerUid, loaded?.videoUrl, patch.moderation);
      return applied;
    },
    notify: (ownerUid, statement) => notifyOwner(options.db, clipId, ownerUid, statement),
  });
}

export async function handleDecideClip(
  request: CallableRequest,
  db: Firestore,
  media?: ClipObjectStore,
): Promise<{ clipId: string; moderation: string }> {
  if (request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admins only.");
  }
  const data = asRecord(request.data);
  const clipId = typeof data?.clipId === "string" ? data.clipId : "";
  const decision = data?.decision;
  const reason = typeof data?.reason === "string" ? data.reason : "";
  if (clipId.length === 0 || clipId.includes("/")) {
    throw new HttpsError("invalid-argument", "Invalid clip.");
  }
  if (decision !== "approved" && decision !== "removed") {
    throw new HttpsError("invalid-argument", "Choose keep or remove.");
  }
  let built;
  try {
    built = adminPatch(decision, reason);
  } catch (error) {
    throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Invalid decision.");
  }
  const snap = await db.collection("clips").doc(clipId).get();
  const ownerUid = snap.get("playerUid");
  const videoUrl = snap.get("videoUrl");
  const applied = await saveClip(db, clipId, built.patch, built.guard);
  if (!applied) {
    throw new HttpsError("failed-precondition", "That clip cannot be moderated.");
  }
  if (built.statement && typeof ownerUid === "string" && ownerUid.length > 0) {
    await notifyOwner(db, clipId, ownerUid, built.statement);
  }
  await syncClipMedia({ db, enabled: true, sentryDsn: "", media }, clipId, ownerUid, videoUrl, decision);
  return { clipId, moderation: decision };
}
