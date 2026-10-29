/**
 * Generates the firestore.rules block that enforces NOTIFICATION_PRESETS.
 * Not imported by the app: the drift test compares its output with the block
 * checked into firestore.rules, and rewrites it when UPDATE_PRESET_RULES=1.
 */
import { NOTIFICATION_PRESETS, USER_PATTERN, escapeRegex, headlinePattern, trickPattern } from "./notificationPresets";

export const PRESET_RULES_BEGIN = "// BEGIN GENERATED: notification presets";
export const PRESET_RULES_END = "// END GENERATED: notification presets";

/** Quote a string as a double-quoted rules literal. */
export function rulesString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A body template as a rules expression: literals plus np*() slot calls. */
function bodyExpr(template: string): string {
  const parts = template
    .split(/(\{user\}|\{trick\}|\{headline\})/)
    .filter((p) => p.length > 0)
    .map((part) => {
      if (part === "{user}") return "npUser()";
      if (part === "{trick}") return "npTrick()";
      if (part === "{headline}") return "npHeadline()";
      return rulesString(escapeRegex(part));
    });
  return `body.matches(${parts.join(" + ")})`;
}

export function buildPresetRulesBlock(indent = "    "): string {
  const lines: string[] = [
    PRESET_RULES_BEGIN,
    "// Do not edit by hand. Source: src/services/notificationPresets.ts (audit M2).",
    "// Regenerate: UPDATE_PRESET_RULES=1 npx vitest run src/services/__tests__/notificationPresets.rules.test.ts",
    "// Game-participant notifications and pushes carry preset copy only. The",
    "// variable parts are a handle, a trick name from src/constants/tricks.ts,",
    "// and preset game-setup labels. matches() is a full-string match.",
    `function npUser() { return ${rulesString(USER_PATTERN)}; }`,
    `function npTrick() { return ${rulesString(trickPattern())}; }`,
    `function npHeadline() { return ${rulesString(headlinePattern())}; }`,
    "function isPresetMessage(type, title, body) {",
  ];
  NOTIFICATION_PRESETS.forEach((preset, i) => {
    const bodies = preset.bodies.map(bodyExpr).join(" || ");
    const lead = i === 0 ? "  return " : "    || ";
    lines.push(`${lead}(type == ${rulesString(preset.type)} && title == ${rulesString(preset.title)}`);
    lines.push(`        && (${bodies}))`);
  });
  lines[lines.length - 1] += ";";
  lines.push("}", PRESET_RULES_END);
  return lines.map((l) => `${indent}${l}`).join("\n");
}

/** Replace the generated block in a rules source. Throws if the markers are missing. */
export function replacePresetRulesBlock(source: string, indent = "    "): string {
  const begin = source.indexOf(`${indent}${PRESET_RULES_BEGIN}`);
  const endMarker = source.indexOf(PRESET_RULES_END);
  if (begin < 0 || endMarker < 0) throw new Error("notification preset markers missing from firestore.rules");
  const end = endMarker + PRESET_RULES_END.length;
  return source.slice(0, begin) + buildPresetRulesBlock(indent) + source.slice(end);
}
