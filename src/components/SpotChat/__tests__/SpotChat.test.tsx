import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, act, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import type { SpotMessage } from "../../../types/spotMessage";

const s = vi.hoisted(() => ({
  send: vi.fn(),
  subscribe: vi.fn(),
  unsub: vi.fn(),
  profile: vi.fn(),
  blocked: new Set<string>(),
  modal: vi.fn(),
}));

vi.mock("../../../services/spotMessages", () => ({
  sendSpotMessage: (...a: unknown[]) => s.send(...a),
  subscribeToSpotMessages: (...a: unknown[]) => s.subscribe(...a),
}));
vi.mock("../../../services/users", () => ({ getUserProfile: (...a: unknown[]) => s.profile(...a) }));
vi.mock("../../../hooks/useBlockedUsers", () => ({ useBlockedUsers: () => s.blocked }));
vi.mock("../../ReportModal", () => ({
  ReportModal: (props: { onClose: () => void; onSubmitted: () => void }) => {
    s.modal(props);
    return (
      <div role="dialog">
        <button type="button" onClick={props.onClose}>
          close-report
        </button>
        <button type="button" onClick={props.onSubmitted}>
          submit-report
        </button>
      </div>
    );
  },
}));

import { SpotChat } from "../SpotChat";
import { _resetChatAuthorCache } from "../useChatAuthors";

const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const msg = (over: Partial<SpotMessage>): SpotMessage => ({
  id: "m",
  spotId: "s1",
  userId: "other",
  content: "hello",
  createdAt: "2026-01-01T00:00:00Z",
  isHidden: false,
  ...over,
});

type SubOpts = { onMessages: (m: SpotMessage[]) => void; onError: (e: Error) => void };
const lastSub = () => s.subscribe.mock.calls.at(-1)![0] as SubOpts;

beforeEach(() => {
  vi.clearAllMocks();
  s.subscribe.mockReturnValue(s.unsub);
  s.send.mockResolvedValue(undefined);
  s.profile.mockImplementation(async (uid: string) => (uid === "other" ? { username: "nyjah" } : null));
  s.blocked = new Set();
  _resetChatAuthorCache();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SpotChat", () => {
  it("asks signed-out users to sign in", () => {
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId={null} />);
    expect(screen.getByText("Sign in to join the chat")).toBeInTheDocument();
  });

  it("does not subscribe without a spot id", () => {
    render(<SpotChat spotId="" spotName="Hubba" currentUserId="me" />);
    expect(s.subscribe).not.toHaveBeenCalled();
  });

  it("renders own, others' and hidden messages", async () => {
    const { unmount } = render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    act(() =>
      lastSub().onMessages([
        msg({ id: "a", content: "theirs" }),
        msg({ id: "b", userId: "me", content: "mine", isHidden: true }),
        msg({ id: "c", isHidden: true, hiddenReason: "word_filter" }),
        msg({ id: "d", isHidden: true }),
      ]),
    );
    expect(screen.getByText("Hubba Chat")).toBeInTheDocument();
    expect(screen.getByText("4 messages")).toBeInTheDocument();
    expect(screen.getByText("Hidden from others")).toBeInTheDocument();
    expect(screen.getAllByText("Message hidden by moderation")).toHaveLength(2);
    expect(await screen.findAllByLabelText("Report message by @nyjah")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "@nyjah" })[0]).toHaveAttribute("href", "/player/other");
    unmount();
    expect(s.unsub).toHaveBeenCalled();
  });

  it("surfaces subscription errors", () => {
    const onError = vi.fn();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" onError={onError} />);
    act(() => lastSub().onError(new Error("denied")));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Failed to load messages"));
    expect(screen.getByText(/Failed to load messages/)).toBeInTheDocument();
  });

  it("sends with Enter and ignores Shift+Enter and blank input", async () => {
    const u = userEvent.setup();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    const input = screen.getByPlaceholderText("Type a message...");
    await u.type(input, "{Enter}");
    expect(s.send).not.toHaveBeenCalled();
    await u.type(input, "yo{Shift>}{Enter}{/Shift}");
    expect(s.send).not.toHaveBeenCalled();
    await u.type(input, "{Enter}");
    expect(s.send).toHaveBeenCalledWith({ spotId: "s1", userId: "me", content: "yo" });
    expect(input).toHaveValue("");
  });

  it("restores input on a send error and shows the length warning", async () => {
    s.send.mockRejectedValue(new Error("slow down"));
    const onError = vi.fn();
    const u = userEvent.setup();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" onError={onError} />);
    const input = screen.getByPlaceholderText("Type a message...");
    await u.type(input, "hey");
    await u.click(screen.getByRole("button", { name: "" }));
    expect(onError).toHaveBeenCalled();
    expect(input).toHaveValue("hey");
    await u.clear(input);
    await u.click(input);
    await u.paste("x".repeat(460));
    expect(screen.getByText(/Max length/)).toBeInTheDocument();
  });

  it("shows the thread oldest first, leaves out blocked players, and labels unknown authors", async () => {
    s.blocked = new Set(["blocked"]);
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    // The subscription delivers newest first.
    act(() =>
      lastSub().onMessages([
        msg({ id: "new", userId: "ghost", content: "second" }),
        msg({ id: "x", userId: "blocked", content: "from a blocked player" }),
        msg({ id: "old", content: "first" }),
      ]),
    );
    expect(screen.queryByText("from a blocked player")).not.toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    const texts = screen.getAllByText(/^(first|second)$/).map((el) => el.textContent);
    expect(texts).toEqual(["first", "second"]);
    expect(await screen.findByRole("link", { name: "skater" })).toHaveAttribute("href", "/player/ghost");
    expect(screen.getByLabelText("Report this message")).toBeInTheDocument();
  });

  it("falls back to 'skater' when a profile can't be read, and caches lookups", async () => {
    s.profile.mockRejectedValue(new Error("denied"));
    const { rerender } = render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    act(() => lastSub().onMessages([msg({ id: "a" }), msg({ id: "b" })]));
    expect(await screen.findAllByRole("link", { name: "skater" })).toHaveLength(2);
    rerender(
      <MemoryRouter>
        <SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(s.profile).toHaveBeenCalledTimes(1));
  });

  it("opens the report sheet for a chat message, into the main reports queue", async () => {
    const u = userEvent.setup();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    act(() => lastSub().onMessages([msg({ id: "a", content: "rude" })]));
    await u.click(await screen.findByLabelText("Report message by @nyjah"));
    await screen.findByRole("dialog");
    expect(s.modal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reporterUid: "me",
        reportedUid: "other",
        reportedUsername: "nyjah",
        gameId: null,
        spotId: "s1",
        message: { id: "a", text: "rude" },
      }),
    );
    await u.click(screen.getByText("close-report"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await u.click(screen.getByLabelText("Report message by @nyjah"));
    await u.click(await screen.findByText("submit-report"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("files a report with an empty handle when the author's handle isn't known yet", async () => {
    s.profile.mockReturnValue(new Promise(() => {}));
    const u = userEvent.setup();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" />);
    act(() => lastSub().onMessages([msg({ id: "a" })]));
    await u.click(screen.getByLabelText("Report this message"));
    await screen.findByRole("dialog");
    expect(s.modal).toHaveBeenLastCalledWith(expect.objectContaining({ reportedUsername: "" }));
  });
});
