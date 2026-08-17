/**
 * Display metadata for the launch badge set (Economy Phase A).
 *
 * The badge *ids* are the source of truth and live server-side — the grant
 * writer stamps `users/{uid}/achievements/{id}`. This module owns only how a
 * granted id is presented: label, one-line description, and the icon.
 *
 * Unknown ids are expected, not exceptional: a later release can grant a badge
 * the running client has never heard of. {@link getBadgeMeta} returns
 * `undefined` for those so callers skip them rather than rendering a blank
 * chip labelled with a raw key.
 *
 * No Firebase imports here — pure display metadata, safe for services and UI.
 */

import { Crown, Flame, MapPin, Medal, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface BadgeMeta {
  /** Short display name shown under the chip. */
  label: string;
  /** One-line earn condition, used in the accessible label and tooltips. */
  description: string;
  /** lucide-react icon component rendered inside the chip. */
  Icon: LucideIcon;
}

/** The five launch badges, keyed by grant id. */
export const BADGE_META: Readonly<Record<string, BadgeMeta>> = {
  century: { label: "Century", description: "Complete 100 games", Icon: Medal },
  club150: { label: "150 Club", description: "Win 150 games", Icon: Trophy },
  og: { label: "OG", description: "Founding-year account", Icon: Crown },
  streak10: { label: "Streak", description: "10 wins in a row", Icon: Flame },
  pioneer: { label: "Pioneer", description: "Spots the community plays at", Icon: MapPin },
};

/**
 * Look up presentation metadata for a badge id. Returns `undefined` for ids
 * this build doesn't know about — callers must skip rather than guess.
 */
export function getBadgeMeta(id: string): BadgeMeta | undefined {
  return Object.hasOwn(BADGE_META, id) ? BADGE_META[id] : undefined;
}
