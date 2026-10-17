import type { TrickObstacle, TrickSelection, TrickStance } from "../constants/tricks.js";
import { formatTrickDisplayName, isValidTrickSelection, sanitizeTrickCustom } from "../constants/tricks.js";
import type { GameDoc, TurnRecord } from "./games.mappers.js";

/** Fields written beside `currentTrickName`. Nulls keep a later free-text set from inheriting the last pick. */
export interface StoredTrickFields {
  currentTrickId: string | null;
  currentTrickStance: TrickStance | null;
  currentTrickObstacle: TrickObstacle | null;
  currentTrickNameCustom: string | null;
}

export function clearedTrickFields(): StoredTrickFields {
  return {
    currentTrickId: null,
    currentTrickStance: null,
    currentTrickObstacle: null,
    currentTrickNameCustom: null,
  };
}

/**
 * Normalize a picker selection into the game-doc fields plus the display
 * name. Returns null when the caller did not use the picker (flag off).
 * Throws when the picker sent a selection the catalog does not recognize.
 */
export function trickFieldsFromSelection(selection: TrickSelection | null | undefined): {
  displayName: string | null;
  fields: StoredTrickFields;
} {
  if (!selection) {
    return { displayName: null, fields: clearedTrickFields() };
  }
  const normalized: TrickSelection = {
    trickId: selection.trickId,
    stance: selection.stance,
    obstacle: selection.obstacle,
    trickNameCustom: sanitizeTrickCustom(selection.trickNameCustom),
  };
  if (!isValidTrickSelection(normalized)) {
    throw new Error("Pick a trick from the list");
  }
  const displayName = formatTrickDisplayName(normalized);
  return {
    displayName,
    fields: {
      currentTrickId: normalized.trickId,
      currentTrickStance: normalized.stance,
      currentTrickObstacle: normalized.obstacle,
      currentTrickNameCustom: normalized.trickNameCustom,
    },
  };
}

/** Copy structured fields onto a turn record. Omitted entirely when the turn was free text. */
export function trickSnapshot(
  game: Pick<GameDoc, "currentTrickId" | "currentTrickStance" | "currentTrickObstacle" | "currentTrickNameCustom">,
): Partial<Pick<TurnRecord, "trickId" | "stance" | "obstacle" | "trickNameCustom">> {
  if (typeof game.currentTrickId !== "string" || game.currentTrickId.length === 0) return {};
  return {
    trickId: game.currentTrickId,
    stance: game.currentTrickStance ?? "regular",
    obstacle: game.currentTrickObstacle ?? null,
    trickNameCustom: game.currentTrickNameCustom ?? null,
  };
}
