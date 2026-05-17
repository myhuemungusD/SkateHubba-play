import { describe, it, expect } from "vitest";

import { installGamesTestBeforeEach } from "./games.test-helpers";

import { isJudgeActive } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
  describe("isJudgeActive", () => {
    it("returns false when no judge is set", () => {
      expect(isJudgeActive({ judgeId: null, judgeStatus: null })).toBe(false);
    });

    it("returns false when judge is pending", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "pending" })).toBe(false);
    });

    it("returns false when judge declined", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "declined" })).toBe(false);
    });

    it("returns true only when judge accepted", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "accepted" })).toBe(true);
    });
  });
});
