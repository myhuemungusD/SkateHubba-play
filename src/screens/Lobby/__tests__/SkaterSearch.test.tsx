import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "../../../services/users";

const dir = vi.hoisted(() => ({ usePlayerDirectory: vi.fn() }));
vi.mock("../../../hooks/usePlayerDirectory", () => dir);
const prefix = vi.hoisted(() => ({ usePrefixSkaterSearch: vi.fn() }));
vi.mock("../usePrefixSkaterSearch", () => prefix);

import { SkaterSearch, mergeMatches, normalizeSkaterQuery } from "../components/SkaterSearch";

const p = (uid: string, username: string): UserProfile => ({ uid, username, stance: "regular", createdAt: null });
const players = [p("a", "skatekid"), p("b", "kidflip"), p("c", "tony"), p("d", "kickflipking")];
// Result rows are one button each, named by their own text (audit #10, #32).
const rowHandles = () =>
  screen
    .getAllByRole("button", { name: /, view profile$/ })
    .map((b) => within(b).getByText(/^@/).textContent?.slice(1));

function setup(canChallenge = true) {
  const onChallengeUser = vi.fn();
  const onViewPlayer = vi.fn();
  render(
    <SkaterSearch
      viewerUid="me"
      canChallenge={canChallenge}
      onChallengeUser={onChallengeUser}
      onViewPlayer={onViewPlayer}
    />,
  );
  const input = screen.getByRole("searchbox", { name: "Search skaters by username" });
  return { input, onChallengeUser, onViewPlayer };
}

describe("normalizeSkaterQuery", () => {
  it("trims, drops a leading @ and lowercases", () => {
    expect(normalizeSkaterQuery("  @@TonY ")).toBe("tony");
    expect(normalizeSkaterQuery("   ")).toBe("");
  });
});

describe("mergeMatches", () => {
  it("puts prefix hits first, dedupes by uid and caps at 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => p(`d${i}`, `xx${i}`));
    const out = mergeMatches([p("d1", "xx1"), p("z", "xxz")], many, "xx");
    expect(out.map((u) => u.uid)).toEqual(["d1", "z", "d0", "d2", "d3", "d4", "d5", "d6"]);
  });
});

describe("SkaterSearch", () => {
  beforeEach(() => {
    dir.usePlayerDirectory.mockReset();
    dir.usePlayerDirectory.mockReturnValue({ players, loading: false, refresh: vi.fn() });
    prefix.usePrefixSkaterSearch.mockReset();
    prefix.usePrefixSkaterSearch.mockReturnValue({ players: [], loading: false });
  });

  it("finds older skaters outside the newest-100 directory via the prefix search, first and deduped", async () => {
    prefix.usePrefixSkaterSearch.mockImplementation((q: string) => ({
      players: q === "kid" ? [p("old", "kidold"), p("b", "kidflip")] : [],
      loading: false,
    }));
    const { input } = setup();
    await userEvent.type(input, "Kid");
    expect(prefix.usePrefixSkaterSearch).toHaveBeenLastCalledWith("kid", "me");
    expect(rowHandles()).toEqual(["kidold", "kidflip", "skatekid"]);
  });

  it("holds the empty state while the prefix search is still running", async () => {
    prefix.usePrefixSkaterSearch.mockReturnValue({ players: [], loading: true });
    const { input } = setup();
    await userEvent.type(input, "zzz");
    expect(screen.queryByText(/No skaters match/)).toBeNull();
  });

  it("reads nothing until the skater types", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Find a skater" })).toBeInTheDocument();
    expect(dir.usePlayerDirectory).not.toHaveBeenCalled();
  });

  it("filters by handle, prefix matches first, and opens a result's profile", async () => {
    const { input, onChallengeUser, onViewPlayer } = setup();
    await userEvent.type(input, "@KID");
    expect(dir.usePlayerDirectory).toHaveBeenCalledWith("me");
    expect(rowHandles()).toEqual(["kidflip", "skatekid"]);
    // Browse rows carry no Challenge button: Challenge lives on the profile.
    expect(screen.queryByRole("button", { name: /^Challenge @/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^@skatekid.*view profile$/ }));
    expect(onViewPlayer).toHaveBeenCalledWith("a");
    expect(onChallengeUser).not.toHaveBeenCalled();
  });

  it("caps the result list", async () => {
    dir.usePlayerDirectory.mockReturnValue({
      players: Array.from({ length: 12 }, (_, i) => p(`u${i}`, `sk8_${i}`)),
      loading: false,
      refresh: vi.fn(),
    });
    const { input } = setup();
    await userEvent.type(input, "sk8");
    expect(rowHandles()).toHaveLength(8);
  });

  it("shows the loading skeleton while the directory loads", async () => {
    dir.usePlayerDirectory.mockReturnValue({ players: [], loading: true, refresh: vi.fn() });
    const { input } = setup();
    await userEvent.type(input, "zz");
    expect(screen.getByRole("status", { name: "Loading skaters" })).toBeInTheDocument();
  });

  it("offers the exact handle when nobody in the directory matches", async () => {
    const { input, onChallengeUser } = setup();
    await userEvent.type(input, "nobody_here");
    expect(screen.getByRole("status")).toHaveTextContent("No skaters match “nobody_here”.");
    await userEvent.click(screen.getByRole("button", { name: "Challenge @nobody_here" }));
    expect(onChallengeUser).toHaveBeenCalledWith("nobody_here");
  });

  it("offers no exact-handle challenge for invalid or short handles, or when the viewer can't challenge", async () => {
    const { input } = setup(false);
    await userEvent.type(input, "nobody_here");
    expect(screen.queryByRole("button", { name: /Challenge @/ })).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, "zz");
    expect(screen.getByRole("status")).toHaveTextContent("No skaters match");
  });

  it("rejects handles with characters usernames can't have", async () => {
    const { input } = setup();
    await userEvent.type(input, "no way");
    expect(screen.queryByRole("button", { name: /Challenge @/ })).toBeNull();
  });

  it("still lets an unverified viewer open a result's profile", async () => {
    const { input, onViewPlayer } = setup(false);
    await userEvent.type(input, "tony");
    await userEvent.click(screen.getByRole("button", { name: /^@tony.*view profile$/ }));
    expect(onViewPlayer).toHaveBeenCalledWith("c");
  });
});
