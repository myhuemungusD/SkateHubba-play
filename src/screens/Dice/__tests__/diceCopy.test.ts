import { describe, expect, it } from "vitest";
import { diceEndLine, opponentName, opponentUid } from "../diceCopy";

describe("diceEndLine", () => {
  it("stays quiet during a live match", () => {
    expect(diceEndLine("active", null, null, "u1")).toBeNull();
  });

  it("names a decline and an unstarted expiry", () => {
    expect(diceEndLine("declined", "decline", null, "u1")).toBe("They declined");
    expect(diceEndLine("expired", "quit", null, "u1")).toBe("The match ended");
  });

  it("tells the winner and the player who left apart, including a timeout", () => {
    expect(diceEndLine("forfeit", "quit", "u1", "u1")).toBe("You got the win");
    expect(diceEndLine("forfeit", "quit", "u2", "u1")).toBe("You left the match");
    expect(diceEndLine("forfeit", "timeout", "u1", "u1")).toBe("Their turn expired. You got the win.");
    expect(diceEndLine("forfeit", "timeout", "u2", "u1")).toBe("Your turn expired.");
  });
});

describe("opponent helpers", () => {
  it("picks the other seat", () => {
    expect(opponentUid("u1", "u2", "u1")).toBe("u2");
    expect(opponentUid("u1", "u2", "u2")).toBe("u1");
    expect(opponentName("u1", "jay", "remy", "u1")).toBe("remy");
    expect(opponentName("u1", "jay", "remy", "u2")).toBe("jay");
  });
});
