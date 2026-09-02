import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpponentPicker } from "../OpponentPicker";
import type { UserProfile } from "../../services/users";

/**
 * Step 1 of the challenge flow. The selection/collapse contract is the
 * picker's own; the roster hook is exercised only as far as proving the
 * picker wires it up (usePlayerDirectory.test.ts owns the hook).
 */

const mockGetPlayerDirectory = vi.fn();
const mockGetBlockedUserIds = vi.fn();

vi.mock("../../services/users", () => ({
  getPlayerDirectory: (...args: unknown[]) => mockGetPlayerDirectory(...args),
}));
vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: (...args: unknown[]) => mockGetBlockedUserIds(...args),
}));
vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function player(uid: string, username: string): UserProfile {
  return { uid, username, stance: "Regular", createdAt: null };
}

const viewer = player("u1", "sk8r");
const rival = player("u2", "kickflip_king");

const base = {
  viewerUid: viewer.uid,
  collapsed: false,
  onSelect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlayerDirectory.mockResolvedValue([viewer, rival]);
  mockGetBlockedUserIds.mockResolvedValue(new Set<string>());
});

describe("OpponentPicker", () => {
  it("shows the roster by default while no opponent is chosen", async () => {
    render(<OpponentPicker {...base} />);

    expect(await screen.findByText("@kickflip_king")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-skaters-toggle")).not.toBeInTheDocument();
  });

  it("mounts the directory hook for the viewer, so they and their blocked list are excluded", async () => {
    // The filtering itself is usePlayerDirectory's contract (its own suite);
    // this pins that the picker hands the hook the right uid.
    mockGetPlayerDirectory.mockResolvedValue([viewer, rival, player("u3", "blocked_guy")]);
    mockGetBlockedUserIds.mockResolvedValue(new Set(["u3"]));
    render(<OpponentPicker {...base} />);

    await screen.findByText("@kickflip_king");
    expect(mockGetBlockedUserIds).toHaveBeenCalledWith("u1");
    expect(screen.queryByText("@sk8r")).not.toBeInTheDocument();
    expect(screen.queryByText("@blocked_guy")).not.toBeInTheDocument();
  });

  it("tapping Challenge on a row fills the opponent via onSelect", async () => {
    const onSelect = vi.fn();
    render(<OpponentPicker {...base} onSelect={onSelect} />);

    await userEvent.click(await screen.findByRole("button", { name: "Challenge @kickflip_king" }));

    expect(onSelect).toHaveBeenCalledWith("kickflip_king");
  });

  it("row Challenge buttons are always enabled — the verification gate lives on the route", async () => {
    render(<OpponentPicker {...base} />);

    expect(await screen.findByRole("button", { name: "Challenge @kickflip_king" })).toBeEnabled();
  });

  it("passes onViewPlayer through to the roster rows", async () => {
    const onViewPlayer = vi.fn();
    render(<OpponentPicker {...base} onViewPlayer={onViewPlayer} />);

    await userEvent.click(await screen.findByRole("button", { name: "View @kickflip_king's profile" }));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  it("folds to a Browse skaters toggle once an opponent is chosen", async () => {
    render(<OpponentPicker {...base} collapsed />);

    expect(screen.getByTestId("browse-skaters-toggle")).toHaveTextContent("Browse skaters");
    expect(screen.queryByText("SKATERS")).not.toBeInTheDocument();
    // The directory hook still mounts (hooks run unconditionally) — let its
    // fetch settle so the state update lands inside the test.
    await waitFor(() => expect(mockGetPlayerDirectory).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText("@kickflip_king")).not.toBeInTheDocument();
  });

  it("Browse skaters reopens the roster, and picking a skater folds it again", async () => {
    const onSelect = vi.fn();
    render(<OpponentPicker {...base} collapsed onSelect={onSelect} />);

    await userEvent.click(screen.getByTestId("browse-skaters-toggle"));
    await userEvent.click(await screen.findByRole("button", { name: "Challenge @kickflip_king" }));

    expect(onSelect).toHaveBeenCalledWith("kickflip_king");
    await waitFor(() => {
      expect(screen.getByTestId("browse-skaters-toggle")).toBeInTheDocument();
    });
    expect(screen.queryByText("@kickflip_king")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton until the roster resolves", async () => {
    let resolve!: (v: UserProfile[]) => void;
    mockGetPlayerDirectory.mockReturnValue(new Promise<UserProfile[]>((r) => (resolve = r)));
    render(<OpponentPicker {...base} />);

    expect(screen.getByRole("status", { name: /loading skaters/i })).toBeInTheDocument();

    resolve([rival]);
    expect(await screen.findByText("@kickflip_king")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading skaters/i })).not.toBeInTheDocument();
  });

  it("renders nothing, without crashing, when the roster fetch fails", async () => {
    mockGetPlayerDirectory.mockRejectedValue(new Error("Network error"));
    const { container } = render(<OpponentPicker {...base} />);

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /loading skaters/i })).not.toBeInTheDocument();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
