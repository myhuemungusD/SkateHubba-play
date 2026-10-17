/**
 * Pure planning for `trainingLabels` documents.
 *
 * The cron in `api/cron/_trainingLabels.ts` is the only writer. This module
 * decides what a resolved turn should become, so the rules and the tests
 * can stay free of the Admin SDK.
 */

import type { TrickObstacle, TrickStance } from "../constants/tricks.js";

export type TrainingRole = "set" | "match";
export type TrainingVia = "play" | "judge" | "dispute" | "forfeit";
export type TrainingOutcome =
  "landed" | "missed" | "judge_landed" | "judge_missed" | "dispute_landed" | "dispute_missed" | "forfeit";

export interface TrainingTurn {
  turnNumber: number;
  trickName?: string;
  trickId?: string;
  stance?: TrickStance;
  obstacle?: TrickObstacle | null;
  trickNameCustom?: string | null;
  setterUid: string;
  matcherUid: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  landed: boolean;
  judgedBy?: string | null;
}

export interface TrainingConsentSnapshot {
  optedIn: boolean;
  policyVersion: string | null;
  updatedAtMs: number | null;
}

export interface TrainingLabelDraft {
  id: string;
  gameId: string;
  turnNumber: number;
  role: TrainingRole;
  ownerUid: string;
  clipPath: string;
  trickId: string;
  stance: TrickStance;
  obstacle: TrickObstacle | null;
  trickNameCustom: string | null;
  outcome: TrainingOutcome;
  via: TrainingVia;
  consent: TrainingConsentSnapshot;
  excluded: boolean;
}

const VIDEO_EXT = /\.(webm|mp4)(?:$|\?)/i;

/** Storage path the uploader used. Download URLs are not stable enough to train on. */
export function clipStoragePath(
  gameId: string,
  turnNumber: number,
  role: TrainingRole,
  uid: string,
  videoUrl: string | null,
): string | null {
  if (!videoUrl) return null;
  const match = VIDEO_EXT.exec(videoUrl);
  if (!match) return null;
  return `games/${gameId}/turn-${turnNumber}/${role}-${uid}.${match[1].toLowerCase()}`;
}

export function trainingLabelId(gameId: string, turnNumber: number, role: TrainingRole): string {
  return `${gameId}_${turnNumber}_${role}`;
}

function viaFor(
  turn: TrainingTurn,
  game: { status?: unknown; lastResolvedDisputeTurnNumber?: unknown },
  lastTurn: boolean,
): TrainingVia {
  if (game.status === "forfeit" && lastTurn) return "forfeit";
  if (typeof turn.judgedBy === "string" && turn.judgedBy.length > 0) return "judge";
  if (game.lastResolvedDisputeTurnNumber === turn.turnNumber) return "dispute";
  return "play";
}

function outcomeFor(role: TrainingRole, landed: boolean, via: TrainingVia): TrainingOutcome {
  if (via === "forfeit") return "forfeit";
  if (role === "set") {
    if (via === "judge") return "judge_landed";
    if (via === "dispute") return landed ? "dispute_landed" : "dispute_missed";
    return "landed";
  }
  if (via === "judge") return landed ? "judge_landed" : "judge_missed";
  if (via === "dispute") return landed ? "dispute_landed" : "dispute_missed";
  return landed ? "landed" : "missed";
}

/**
 * One label per clip that has both a catalog trick and a storage path.
 * Free-text turns (no trickId) produce nothing — the picker flag is what
 * starts the dataset.
 */
export function labelsForTurn(
  gameId: string,
  turn: TrainingTurn,
  game: { status?: unknown; lastResolvedDisputeTurnNumber?: unknown },
  consentFor: (uid: string) => TrainingConsentSnapshot,
  lastTurn = false,
): TrainingLabelDraft[] {
  if (typeof turn.trickId !== "string" || turn.trickId.length === 0) return [];
  if (typeof turn.turnNumber !== "number") return [];
  const via = viaFor(turn, game, lastTurn);
  const stance: TrickStance = turn.stance ?? "regular";
  const drafts: TrainingLabelDraft[] = [];
  const roles: Array<{ role: TrainingRole; uid: string; url: string | null }> = [
    { role: "set", uid: turn.setterUid, url: turn.setVideoUrl },
    { role: "match", uid: turn.matcherUid, url: turn.matchVideoUrl },
  ];
  for (const entry of roles) {
    if (typeof entry.uid !== "string" || entry.uid.length === 0) continue;
    const clipPath = clipStoragePath(gameId, turn.turnNumber, entry.role, entry.uid, entry.url);
    if (!clipPath) continue;
    const consent = consentFor(entry.uid);
    drafts.push({
      id: trainingLabelId(gameId, turn.turnNumber, entry.role),
      gameId,
      turnNumber: turn.turnNumber,
      role: entry.role,
      ownerUid: entry.uid,
      clipPath,
      trickId: turn.trickId,
      stance,
      obstacle: turn.obstacle ?? null,
      trickNameCustom: turn.trickNameCustom ?? null,
      outcome: outcomeFor(entry.role, turn.landed === true, via),
      via,
      consent,
      excluded: consent.optedIn !== true,
    });
  }
  return drafts;
}

/** Labels whose clip was taken before this withdrawal stay excluded. Later opt-ins do not. */
export function labelPredatesRevocation(createdAtMs: number | null, revokedAtMs: number): boolean {
  if (createdAtMs === null) return true;
  return createdAtMs <= revokedAtMs;
}

function millisOfUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis: unknown }).toMillis;
    if (typeof toMillis !== "function") return null;
    const ms = toMillis.call(value);
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Consent as of the moment the cron copies a clip into the training set. */
export function consentSnapshotFromProfile(data: Record<string, unknown> | null | undefined): TrainingConsentSnapshot {
  if (!data) return { optedIn: false, policyVersion: null, updatedAtMs: null };
  return {
    optedIn: data.trainingConsentOptedIn === true,
    policyVersion: typeof data.trainingConsentPolicyVersion === "string" ? data.trainingConsentPolicyVersion : null,
    updatedAtMs: millisOfUnknown(data.trainingConsentUpdatedAt),
  };
}

export function revocationMillis(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null;
  return millisOfUnknown(data.revokedAt);
}
