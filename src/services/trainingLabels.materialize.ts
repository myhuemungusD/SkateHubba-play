/**
 * Drain pending game turns into `trainingLabels`, then mark withdrawn
 * skaters' existing labels excluded.
 *
 * Called from the existing sweep cron (`api/cron/sweep-expired-turns.ts`)
 * so this does not add a schedule or a Cloud Function. Admin credentials
 * bypass the client rules: the collection is admin-read, server-write.
 */

import {
  consentSnapshotFromProfile,
  labelPredatesRevocation,
  labelsForTurn,
  revocationMillis,
  type TrainingConsentSnapshot,
  type TrainingTurn,
} from "./trainingLabels.shared.js";

const PENDING_LIMIT = 40;
const REVOCATION_LIMIT = 40;

export interface MaterializeSummary {
  games: number;
  labels: number;
  excluded: number;
  errors: number;
}

interface DocSnap {
  id: string;
  ref: { update(data: Record<string, unknown>): Promise<unknown>; delete(): Promise<unknown> };
  data(): Record<string, unknown> | undefined;
  exists?: boolean;
}

interface Query {
  where(field: string, op: "==", value: unknown): Query;
  limit(n: number): Query;
  get(): Promise<{ docs: DocSnap[] }>;
}

interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

/** Structural slice of firebase-admin Firestore the sweep already holds. */
export interface TrainingLabelDb {
  collection(name: string): Query & { doc(id: string): DocRef };
}

function emptySummary(): MaterializeSummary {
  return { games: 0, labels: 0, excluded: 0, errors: 0 };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asTurn(value: unknown): TrainingTurn | null {
  if (!value || typeof value !== "object") return null;
  const turn = value as TrainingTurn;
  if (typeof turn.setterUid !== "string" || typeof turn.matcherUid !== "string") return null;
  if (typeof turn.turnNumber !== "number") return null;
  return turn;
}

/**
 * Write labels for games flagged `trainingLabelPending`, then apply
 * withdrawals. One bad game never aborts the pass. Dry-run counts only.
 */
export async function materializeTrainingLabels(
  db: TrainingLabelDb,
  options: { dryRun: boolean; now?: Date },
): Promise<MaterializeSummary> {
  const summary = emptySummary();
  const now = options.now ?? new Date();
  const consentCache = new Map<string, TrainingConsentSnapshot>();

  const consentFor = async (uid: string): Promise<TrainingConsentSnapshot> => {
    const cached = consentCache.get(uid);
    if (cached) return cached;
    const snap = await db.collection("users").doc(`${uid}/private/profile`).get();
    const profile = snap.exists === false ? null : (snap.data() ?? null);
    const snapshot = consentSnapshotFromProfile(profile);
    consentCache.set(uid, snapshot);
    return snapshot;
  };

  let pending: { docs: DocSnap[] };
  try {
    pending = await db.collection("games").where("trainingLabelPending", "==", true).limit(PENDING_LIMIT).get();
  } catch (err) {
    summary.errors += 1;
    console.warn(
      JSON.stringify({
        event: "training_labels_query_failed",
        message: errorMessage(err),
      }),
    );
    return summary;
  }

  for (const gameDoc of pending.docs) {
    summary.games += 1;
    try {
      const data = gameDoc.data() ?? {};
      const history = Array.isArray(data.turnHistory) ? data.turnHistory : [];
      for (let index = 0; index < history.length; index += 1) {
        const turn = asTurn(history[index]);
        if (!turn) continue;
        const drafts = labelsForTurn(
          gameDoc.id,
          turn,
          data,
          () => ({ optedIn: false, policyVersion: null, updatedAtMs: null }),
          index === history.length - 1,
        );
        for (const draft of drafts) {
          const snapshot = await consentFor(draft.ownerUid);
          draft.consent = snapshot;
          draft.excluded = snapshot.optedIn !== true;
          const ref = db.collection("trainingLabels").doc(draft.id);
          const existing = await ref.get();
          const already = existing.exists === false ? undefined : existing.data();
          if (already) continue;
          if (!options.dryRun) {
            const stored: Record<string, unknown> = { ...draft, createdAt: now };
            delete stored.id;
            await ref.set(stored);
          }
          summary.labels += 1;
        }
      }
      if (options.dryRun) continue;
      await gameDoc.ref.update({ trainingLabelPending: false });
    } catch (err) {
      summary.errors += 1;
      console.warn(
        JSON.stringify({
          event: "training_labels_game_failed",
          gameId: gameDoc.id,
          message: errorMessage(err),
        }),
      );
    }
  }

  await applyRevocations(db, options.dryRun, now, summary);
  return summary;
}

async function applyRevocations(
  db: TrainingLabelDb,
  dryRun: boolean,
  now: Date,
  summary: MaterializeSummary,
): Promise<void> {
  let revocations: { docs: DocSnap[] };
  try {
    revocations = await db.collection("trainingRevocations").limit(REVOCATION_LIMIT).get();
  } catch (err) {
    summary.errors += 1;
    console.warn(
      JSON.stringify({
        event: "training_revocations_query_failed",
        message: errorMessage(err),
      }),
    );
    return;
  }

  for (const revocation of revocations.docs) {
    try {
      const revokedAtMs = revocationMillis(revocation.data());
      if (revokedAtMs === null) {
        if (!dryRun) await revocation.ref.delete();
        continue;
      }
      const labels = await db.collection("trainingLabels").where("ownerUid", "==", revocation.id).get();
      for (const label of labels.docs) {
        const data = label.data() ?? {};
        if (data.excluded === true) continue;
        const createdAtMs = revocationMillis({ revokedAt: data.createdAt });
        if (!labelPredatesRevocation(createdAtMs, revokedAtMs)) continue;
        summary.excluded += 1;
        if (!dryRun) {
          await label.ref.update({ excluded: true, excludedAt: now, exclusionReason: "consent_withdrawn" });
        }
      }
      if (!dryRun) await revocation.ref.delete();
    } catch (err) {
      summary.errors += 1;
      console.warn(
        JSON.stringify({
          event: "training_revocation_failed",
          uid: revocation.id,
          message: errorMessage(err),
        }),
      );
    }
  }
}

/** Set when a resolved turn carries a catalog trick. Server clears it after labeling. */
export function applyTrainingLabelPending(
  out: Record<string, unknown>,
  record: { trickId?: string } | undefined,
): void {
  if (typeof record?.trickId === "string" && record.trickId.length > 0) {
    out.trainingLabelPending = true;
  }
}
