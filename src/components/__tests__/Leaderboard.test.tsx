import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Leaderboard } from "../Leaderboard";

const mockGetLeaderboard = vi.fn();
const mockGetBlocked = vi.fn();

vi.mock("../../services/users", () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
}));
vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: (...args: unknown[]) => mockGetBlocked(...args),
}));

const player = (uid: string, username: string, wins: number, losses: number) => ({
  uid,
  username,
  stance: "regular",
  createdAt: null,
  emailVerified: true,
  wins,
  losses,
});

const two = [player("u1", "alice", 10, 2), player("u2", "bob", 1, 1), player("u3", "carol", 0, 0)];
const five = [
  player("u1", "alice", 10, 2),
  player("u2", "bob", 8, 4),
  player("u3", "carol", 6, 4),
  player("u4", "dave", 3, 3),
  player("u5", "erin", 2, 4),
];

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioCallback: IOCallback | null = null;
const OriginalIO = globalThis.IntersectionObserver;

describe("Leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBlocked.mockResolvedValue(new Set());
    ioCallback = null;
    globalThis.IntersectionObserver = class {
      constructor(cb: IOCallback) {
        ioCallback = cb;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = OriginalIO;
  });

  it("shows a loading status first", () => {
    mockGetLeaderboard.mockReturnValue(new Promise(() => {}));
    render(<Leaderboard currentUserUid="u1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading leaderboard…");
  });

  it("lists ranked players without a podium when fewer than three have played", async () => {
    mockGetLeaderboard.mockResolvedValue(two);
    render(<Leaderboard currentUserUid="u1" />);
    const list = await screen.findByRole("list", { name: "Rankings" });
    expect(screen.queryByRole("list", { name: "Top three" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // carol has no finished games
    expect(screen.queryByText("@carol")).not.toBeInTheDocument();
    expect(within(list).getByText("You")).toBeInTheDocument();
  });

  it("labels every figure: record, then win rate or provisional", async () => {
    mockGetLeaderboard.mockResolvedValue(two);
    render(<Leaderboard currentUserUid="u1" />);
    await screen.findByText("@alice");
    expect(screen.getByText("10 wins out of 12 games")).toBeInTheDocument();
    expect(screen.getByText(/83% win rate/)).toBeInTheDocument();
    expect(screen.getByText(/rated after 5 games/)).toBeInTheDocument();
  });

  it("puts the top three on a podium in rank order and the rest below", async () => {
    mockGetLeaderboard.mockResolvedValue(five);
    render(<Leaderboard currentUserUid="u5" />);
    const podium = await screen.findByRole("list", { name: "Top three" });
    const names = within(podium)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(names[0]).toMatch(/@alice.*Rank 1/);
    expect(names[1]).toMatch(/@bob.*Rank 2/);
    expect(names[2]).toMatch(/@carol.*Rank 3/);
    const rest = screen.getByRole("list", { name: "Everyone else" });
    expect(within(rest).getByText("@dave")).toBeInTheDocument();
    expect(within(rest).getByText("@erin").closest("li")).toHaveTextContent("Rank 5");
  });

  it("opens a profile from a podium spot or a row", async () => {
    mockGetLeaderboard.mockResolvedValue(five);
    const onViewPlayer = vi.fn();
    render(<Leaderboard currentUserUid="u1" onViewPlayer={onViewPlayer} />);
    await userEvent.click(await screen.findByRole("button", { name: /@bob/ }));
    await userEvent.click(screen.getByRole("button", { name: /@dave/ }));
    expect(onViewPlayer.mock.calls).toEqual([["u2"], ["u4"]]);
  });

  it("pins your row while it is scrolled below the fold", async () => {
    mockGetLeaderboard.mockResolvedValue(five);
    render(<Leaderboard currentUserUid="u5" />);
    await screen.findByText("@erin");
    expect(screen.queryByTestId("leaderboard-you-pinned")).not.toBeInTheDocument();

    act(() => ioCallback?.([{ isIntersecting: false, boundingClientRect: { top: 900 } as DOMRect }]));
    expect(screen.getByTestId("leaderboard-you-pinned")).toHaveTextContent("Rank 5");

    act(() => ioCallback?.([{ isIntersecting: true, boundingClientRect: { top: 300 } as DOMRect }]));
    expect(screen.queryByTestId("leaderboard-you-pinned")).not.toBeInTheDocument();
  });

  it("never pins you when you're on the podium", async () => {
    mockGetLeaderboard.mockResolvedValue(five);
    render(<Leaderboard currentUserUid="u1" />);
    await screen.findByText("@erin");
    expect(ioCallback).toBeNull();
  });

  it("drops blocked players", async () => {
    mockGetLeaderboard.mockResolvedValue(two);
    mockGetBlocked.mockResolvedValue(new Set(["u2"]));
    render(<Leaderboard currentUserUid="u1" />);
    await screen.findByText("@alice");
    expect(screen.queryByText("@bob")).not.toBeInTheDocument();
  });

  it("shows an error with Try again, and the retry still filters blocked players", async () => {
    mockGetLeaderboard.mockRejectedValueOnce(new Error("network"));
    mockGetBlocked.mockResolvedValue(new Set(["u2"]));
    render(<Leaderboard currentUserUid="u1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the leaderboard.");

    mockGetLeaderboard.mockResolvedValue(two);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());
    expect(screen.queryByText("@bob")).not.toBeInTheDocument();
  });

  it("shows an empty state when nobody has finished a game", async () => {
    mockGetLeaderboard.mockResolvedValue([player("u3", "carol", 0, 0)]);
    render(<Leaderboard currentUserUid="u3" />);
    expect(await screen.findByText("No ranked skaters yet")).toBeInTheDocument();
    expect(screen.getByText("Finish a game to get on the board.")).toBeInTheDocument();
  });

  it("ignores a load that settles after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockGetLeaderboard.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = render(<Leaderboard currentUserUid="u1" />);
    unmount();
    await act(async () => resolve(two));
    expect(screen.queryByText("@alice")).not.toBeInTheDocument();
  });
});
