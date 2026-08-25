import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisputeResultCard } from "../DisputeResultCard";
import type { Dispute } from "../../types/dispute";

function result(verdict?: Dispute["verdict"]): Dispute {
  return {
    id: "game1_4",
    gameId: "game1",
    turnNumber: 4,
    trickName: "Tre flip",
    setterUid: "u1",
    setterUsername: "alice",
    matcherUid: "u2",
    matcherUsername: "bob",
    setVideoUrl: null,
    matchVideoUrl: "https://example.test/match.webm",
    spotId: null,
    createdAt: null,
    status: "closed",
    moderationStatus: "active",
    landVotes: 7,
    bailVotes: 3,
    ...(verdict ? { verdict } : {}),
  };
}

describe("DisputeResultCard", () => {
  it.each([
    ["land", "LAND", "upheld the landing"],
    ["bail", "BAIL", "received a letter"],
    ["tie", "TIE", "retry the trick"],
    ["none", "NO VOTES", "landing stood"],
  ] as const)("renders the %s verdict and game effect", (verdict, heading, effect) => {
    render(<DisputeResultCard dispute={result(verdict)} />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Tre flip")).toBeInTheDocument();
    expect(screen.getByText("LAND 7")).toBeInTheDocument();
    expect(screen.getByText("BAIL 3")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(effect))).toBeInTheDocument();
  });

  it("explains a legacy closed document without a verdict", () => {
    render(<DisputeResultCard dispute={result()} />);
    expect(screen.getByRole("heading", { name: "RESULT UNAVAILABLE" })).toBeInTheDocument();
    expect(screen.getByText(/older dispute was closed without a recorded verdict/)).toBeInTheDocument();
  });
});
