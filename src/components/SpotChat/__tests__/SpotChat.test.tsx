import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpotMessage } from "../../../types/spotMessage";

const s = vi.hoisted(() => ({
  send: vi.fn(),
  subscribe: vi.fn(),
  report: vi.fn(),
  unsub: vi.fn(),
}));

vi.mock("../../../services/spotMessages", () => ({
  sendSpotMessage: (...a: unknown[]) => s.send(...a),
  subscribeToSpotMessages: (...a: unknown[]) => s.subscribe(...a),
  reportSpotMessage: (...a: unknown[]) => s.report(...a),
}));

import { SpotChat } from "../SpotChat";

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
  s.report.mockResolvedValue(undefined);
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

  it("renders own, others' and hidden messages", () => {
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
    expect(screen.getByText("Hidden by filter")).toBeInTheDocument();
    expect(screen.getByText("[Hidden: word_filter]")).toBeInTheDocument();
    expect(screen.getByText("[Hidden: reported]")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Report message")).toHaveLength(1);
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

  it("reports a message and shows report failures", async () => {
    const onError = vi.fn();
    const u = userEvent.setup();
    render(<SpotChat spotId="s1" spotName="Hubba" currentUserId="me" onError={onError} />);
    act(() => lastSub().onMessages([msg({ id: "a" })]));
    await u.click(screen.getByLabelText("Report message"));
    expect(s.report).toHaveBeenCalledWith({ messageId: "a", spotId: "s1", reportedBy: "me", reason: "inappropriate" });
    s.report.mockRejectedValue(new Error("nope"));
    await u.click(screen.getByLabelText("Report message"));
    expect(screen.getByText(/Failed to report message/)).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
  });
});
