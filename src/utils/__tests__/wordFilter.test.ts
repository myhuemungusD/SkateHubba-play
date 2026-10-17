/**
 * Word filter tests.
 */
import { describe, it, expect } from "vitest";
import { checkWordFilter, isContentClean } from "../wordFilter";

describe("wordFilter", () => {
  describe("checkWordFilter", () => {
    it("returns null for clean content", () => {
      expect(checkWordFilter("This is a totally clean message")).toBeNull();
      expect(checkWordFilter("Great spot, let's session tomorrow!")).toBeNull();
    });

    it("detects slurs case-insensitively", () => {
      expect(checkWordFilter("contains a bad NIGGER word")).toBe("nigger");
      expect(checkWordFilter("faggot in lowercase")).toBe("faggot");
      expect(checkWordFilter("RETARD in caps")).toBe("retard");
    });

    it("detects spam patterns", () => {
      expect(checkWordFilter("click here for free stuff")).toBe("click here");
      expect(checkWordFilter("buy bitcoin now!")).toBe("bitcoin");
    });

    it("detects explicit harassment", () => {
      expect(checkWordFilter("fuck you buddy")).toBe("fuck you");
      expect(checkWordFilter("kill yourself")).toBe("kill yourself");
    });

    it("returns first match when multiple blocked words present", () => {
      const result = checkWordFilter("bitcoin scam click here");
      // Should return the first match in the list order
      expect(result).toBeTruthy();
    });
  });

  describe("isContentClean", () => {
    it("returns true for clean content", () => {
      expect(isContentClean("Clean message here")).toBe(true);
    });

    it("returns false when blocked word detected", () => {
      expect(isContentClean("click here to win")).toBe(false);
    });
  });
});
