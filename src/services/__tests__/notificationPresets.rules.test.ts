import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRESET_RULES_BEGIN,
  PRESET_RULES_END,
  buildPresetRulesBlock,
  replacePresetRulesBlock,
  rulesString,
} from "../notificationPresets.rules";

const RULES_PATH = resolve(__dirname, "../../../firestore.rules");

describe("notification preset rules block", () => {
  it("firestore.rules carries the block generated from notificationPresets.ts", () => {
    if (process.env.UPDATE_PRESET_RULES === "1") {
      writeFileSync(RULES_PATH, replacePresetRulesBlock(readFileSync(RULES_PATH, "utf8")));
    }
    const source = readFileSync(RULES_PATH, "utf8");
    // Drift guard: a template or trick-catalog change without regenerating
    // would make the client send copy the rules deny.
    expect(replacePresetRulesBlock(source)).toBe(source);
    expect(source).toContain(buildPresetRulesBlock());
  });

  it("is wired into both create rules", () => {
    const source = readFileSync(RULES_PATH, "utf8");
    expect(source).toContain(
      "isPresetMessage(request.resource.data.type, request.resource.data.title, request.resource.data.body)",
    );
    expect(source).toContain(
      "isPresetMessage(request.resource.data.type, request.resource.data.notification.title, request.resource.data.notification.body)",
    );
  });

  it("emits markers, slot functions and one clause per preset", () => {
    const block = buildPresetRulesBlock("");
    expect(block.startsWith(PRESET_RULES_BEGIN)).toBe(true);
    expect(block.endsWith(PRESET_RULES_END)).toBe(true);
    expect(block).toContain('function npUser() { return "@[a-z0-9_]+"; }');
    expect(block).toContain("Kickflip");
    expect(block).toContain('body.matches(npUser() + " challenged you to S\\\\.K\\\\.A\\\\.T\\\\.E\\\\.")');
    expect(block).toMatch(/\)\)\);\n}\n/);
  });

  it("quotes rules strings", () => {
    expect(rulesString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("throws when the markers are missing", () => {
    expect(() => replacePresetRulesBlock("rules_version = '2';")).toThrow(/markers missing/);
  });
});
