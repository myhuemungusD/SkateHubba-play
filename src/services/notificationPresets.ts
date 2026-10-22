/**
 * Preset copy for game-participant notifications and pushes (security audit
 * 2026-10-21, M2). Players, judges and strangers who were challenged can send
 * each other bell entries and lock-screen pushes, so nothing in those strings
 * may be sender-chosen free text. Every message is one of the templates below.
 * The only variable parts are:
 *
 *   {user}     a handle, `@[a-z0-9_]+`
 *   {trick}    a trick display name from the canonical catalog
 *              (src/constants/tricks.ts: optional stance word + catalog name),
 *              or the fallback word "trick"
 *   {headline} a game-setup label: a preset category label and/or a preset
 *              turn-length label, never the custom-rules text
 *
 * firestore.rules enforces the same set on /notifications and /push_dispatch
 * creates. That rules block is GENERATED from this file by
 * notificationPresets.rules.ts; a drift test fails if they disagree. After
 * editing a template or the trick catalog, regenerate with
 *   UPDATE_PRESET_RULES=1 npx vitest run src/services/__tests__/notificationPresets.rules.test.ts
 *
 * This module has no Firebase imports so the rules generator and the tests can
 * load it directly.
 */
import { STANCE_LABELS, TRICK_STANCES, TRICKS } from "../constants/tricks.js";
import { CUSTOM_CATEGORY_ID, TRICK_CATEGORIES, trickCategoryLabel } from "../constants/trickCategories.js";
import { TURN_LENGTH_OPTIONS, turnLengthLabel } from "./turnDuration.js";

export type PresetNotificationType =
  | "your_turn"
  | "new_challenge"
  | "game_won"
  | "game_lost"
  | "judge_invite"
  | "nudge";

export interface NotificationPreset {
  type: PresetNotificationType;
  title: string;
  /** Body templates. Literal text plus {user}, {trick} and {headline} slots. */
  bodies: readonly string[];
}

/**
 * Every message a client may send to another game participant. Keep in sync
 * with the callers in games.*.ts, disputes.raise.ts, nudge.ts and
 * turnForfeit.shared.ts; a caller whose text is not listed is skipped (logged)
 * rather than written, so a transaction never rolls back on a copy change.
 */
export const NOTIFICATION_PRESETS: readonly NotificationPreset[] = [
  {
    type: "new_challenge",
    title: "New Challenge!",
    bodies: ["{user} challenged you to S.K.A.T.E.", "{user} challenged you to S.K.A.T.E. — {headline}"],
  },
  { type: "judge_invite", title: "You've been asked to referee", bodies: ["{user} vs {user} — accept to rule on disputes"] },
  { type: "nudge", title: "You got nudged!", bodies: ["{user} is waiting for your move"] },
  { type: "game_won", title: "You Won!", bodies: ["vs {user}"] },
  { type: "game_lost", title: "Game Over", bodies: ["vs {user}"] },
  { type: "your_turn", title: "Your Turn!", bodies: ["Match {user}'s {trick}"] },
  {
    type: "your_turn",
    title: "Your Turn to Set!",
    bodies: [
      "{user} couldn't land their trick. Set a trick!",
      "Set a trick for {user}",
      "You landed {user}'s {trick}. Set a trick!",
    ],
  },
  { type: "your_turn", title: "Trick Landed!", bodies: ["You landed! Set a trick for {user}"] },
  {
    type: "your_turn",
    title: "Ruling Needed",
    bodies: [
      "{user} called BS on {user}'s set. Rule clean or sketchy?",
      "{user} claims they landed {user}'s trick. Rule landed or missed?",
    ],
  },
  {
    type: "your_turn",
    title: "Land Claimed",
    bodies: ["{user} claims they landed your trick. Accept or dispute before the timer runs out."],
  },
  { type: "your_turn", title: "Referee ruled: Clean", bodies: ["The set stands. Match {user}'s trick."] },
  { type: "your_turn", title: "Referee ruled: Sketchy", bodies: ["Set a new trick for {user}."] },
  { type: "your_turn", title: "Referee ruled: Landed", bodies: ["You landed! Set a trick for {user}"] },
  { type: "your_turn", title: "Referee ruled: Missed", bodies: ["Set a trick for {user}"] },
  { type: "your_turn", title: "Call sent to the community", bodies: ["{user} disputed your {trick} claim."] },
];

/** Fallback when a trick name is not in the catalog (custom "other" tricks, legacy games). */
export const PRESET_TRICK_FALLBACK = "trick";
/** Fallback handle when a username fails `[a-z0-9_]+`. */
export const PRESET_HANDLE_FALLBACK = "skater";

/** Turn-length labels an invite may announce ("24h turns", "3-day turns", ...). */
export function presetTurnLengthLabels(): string[] {
  return TURN_LENGTH_OPTIONS.map((h) => turnLengthLabel(h));
}

/** Every display name formatTrickDisplayName() can produce from a catalog row. */
export function catalogTrickDisplayNames(): string[] {
  const out: string[] = [];
  for (const stance of TRICK_STANCES) {
    const prefix = stance === "regular" ? "" : `${STANCE_LABELS[stance]} `;
    for (const trick of TRICKS) out.push(`${prefix}${trick.name}`);
  }
  return out;
}

/** Category labels a challenge headline may carry ("any" announces nothing). */
export function presetCategoryLabels(): string[] {
  return TRICK_CATEGORIES.filter((c) => c.id !== "any").map((c) => c.label);
}

let trickByLower: Map<string, string> | null = null;

/**
 * Canonical catalog display name for `raw`, or "trick". Case-insensitive so
 * a legacy lowercase name still shows its catalog spelling.
 */
export function presetTrickName(raw: string | null | undefined): string {
  if (typeof raw !== "string") return PRESET_TRICK_FALLBACK;
  trickByLower ??= new Map(catalogTrickDisplayNames().map((n) => [n.toLowerCase(), n]));
  return trickByLower.get(raw.trim().toLowerCase()) ?? PRESET_TRICK_FALLBACK;
}

/** `raw` when it is a valid handle (`[a-z0-9_]+`), else a neutral fallback. */
export function presetHandle(raw: string | null | undefined): string {
  return typeof raw === "string" && /^[a-z0-9_]{1,30}$/.test(raw) ? raw : PRESET_HANDLE_FALLBACK;
}

/**
 * The challenge-invite headline: a preset category label and/or a preset
 * turn-length label. The custom category announces its label, never the
 * challenger's custom-rules text (free text between strangers).
 */
export function presetChallengeHeadline(categoryId: string | null | undefined, lengthLabel: string | null): string {
  const category =
    !categoryId || categoryId === "any"
      ? null
      : categoryId === CUSTOM_CATEGORY_ID
        ? trickCategoryLabel(CUSTOM_CATEGORY_ID)
        : trickCategoryLabel(categoryId);
  return [category, lengthLabel].filter(Boolean).join(" · ");
}

// ── Pattern construction (shared by the client guard and the rules generator) ──

/** Escape a literal for an RE2 / JS regex. */
export function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const USER_PATTERN = "@[a-z0-9_]+";

export function trickPattern(): string {
  const stances = TRICK_STANCES.filter((s) => s !== "regular").map((s) => escapeRegex(STANCE_LABELS[s]));
  const names = TRICKS.map((t) => escapeRegex(t.name));
  // Legacy clients fell back to "Trick"; accept both spellings of the fallback.
  return `(?:(?:(?:${stances.join("|")}) )?(?:${names.join("|")})|[Tt]rick)`;
}

export function headlinePattern(): string {
  const cats = presetCategoryLabels().map(escapeRegex).join("|");
  const lens = presetTurnLengthLabels().map(escapeRegex).join("|");
  return `(?:(?:${cats})(?: · (?:${lens}))?|(?:${lens}))`;
}

/** Template → regex source (unanchored; callers anchor). */
export function templatePattern(template: string): string {
  return template
    .split(/(\{user\}|\{trick\}|\{headline\})/)
    .map((part) => {
      if (part === "{user}") return USER_PATTERN;
      if (part === "{trick}") return trickPattern();
      if (part === "{headline}") return headlinePattern();
      return escapeRegex(part);
    })
    .join("");
}

let compiled: Array<{ type: string; title: string; re: RegExp }> | null = null;

/** True when (type, title, body) is one of the presets. Mirrors the rules check. */
export function isPresetMessage(type: string, title: string, body: string): boolean {
  compiled ??= NOTIFICATION_PRESETS.flatMap((p) =>
    p.bodies.map((b) => ({ type: p.type, title: p.title, re: new RegExp(`^(?:${templatePattern(b)})$`) })),
  );
  return compiled.some((c) => c.type === type && c.title === title && c.re.test(body));
}
