import { describe, expect, it } from "vitest";
import { diceAccessAllowed } from "./access.js";

describe("diceAccessAllowed", () => {
  it("lets everyone through when the switch is on", () => {
    expect(diceAccessAllowed("anyone", true, "")).toBe(true);
  });

  it("rejects everyone when the switch is off and the allowlist is empty", () => {
    expect(diceAccessAllowed("anyone", false, "")).toBe(false);
    expect(diceAccessAllowed("anyone", false, "  ,  ")).toBe(false);
  });

  it("lets a listed tester through while the switch is off", () => {
    expect(diceAccessAllowed("uid-a", false, "uid-a, uid-b")).toBe(true);
    expect(diceAccessAllowed("uid-b", false, "uid-a,uid-b")).toBe(true);
    expect(diceAccessAllowed("uid-c", false, "uid-a, uid-b")).toBe(false);
  });
});
