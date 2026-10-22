import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blessing } from "../../../services/proBlessing";

const mockBless = vi.fn();
const mockAnswer = vi.fn();
const mockLineage = vi.fn();
const mockMine = vi.fn();
let pendingCb: ((items: Blessing[]) => void) | null = null;

vi.mock("../../../services/proBlessing", () => ({
  BLESSING_REASON_MIN: 10,
  BLESSING_REASON_MAX: 280,
  blessSkater: (...a: unknown[]) => mockBless(...a),
  answerBlessing: (...a: unknown[]) => mockAnswer(...a),
  fetchLineage: (...a: unknown[]) => mockLineage(...a),
  fetchMyBlessings: (...a: unknown[]) => mockMine(...a),
  blessingErrorMessage: (e: unknown) => `msg:${e instanceof Error ? e.message : "?"}`,
  subscribeToPendingBlessings: (_uid: string, cb: (items: Blessing[]) => void) => {
    pendingCb = cb;
    return () => {
      pendingCb = null;
    };
  },
}));

import { BlessProButton } from "../BlessProButton";
import { BlessedByLine } from "../BlessedByLine";
import { BlessingHero } from "../BlessingHero";
import { TurnedProGate } from "../TurnedProGate";

const B = (o: Partial<Blessing> = {}): Blessing => ({
  id: "b1",
  blesserUid: "pro",
  blesserUsername: "bryanherman",
  targetUid: "me",
  targetUsername: "rookie",
  reason: "Real deal ripper.",
  status: "pending",
  createdAtMs: Date.UTC(2026, 9, 1),
  ...o,
});

beforeEach(() => {
  for (const m of [mockBless, mockAnswer, mockLineage, mockMine]) m.mockReset();
  pendingCb = null;
});

describe("BlessProButton", () => {
  it("needs a reason, then sends the blessing", async () => {
    mockBless.mockResolvedValue("b1");
    render(<BlessProButton targetUid="t1" username="rookie" />);
    await userEvent.click(screen.getByTestId("bless-pro-button"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Put @rookie on as PRO?");
    expect(screen.getByTestId("bless-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("bless-reason"), "Filmed with him for years.");
    await userEvent.click(screen.getByTestId("bless-confirm"));
    expect(mockBless).toHaveBeenCalledWith("t1", "Filmed with him for years.");
    expect(await screen.findByTestId("bless-sent")).toHaveTextContent("Sent. @rookie is on once they accept.");
  });

  it("shows the server's reason on failure and can close", async () => {
    mockBless.mockRejectedValue(new Error("limit_reached"));
    render(<BlessProButton targetUid="t1" username="rookie" />);
    await userEvent.click(screen.getByTestId("bless-pro-button"));
    await userEvent.type(screen.getByTestId("bless-reason"), "Filmed with him for years.");
    await userEvent.click(screen.getByTestId("bless-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("msg:limit_reached");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("BlessedByLine", () => {
  it("shows who blessed them, the quote and the lineage", async () => {
    const onView = vi.fn();
    mockLineage.mockResolvedValue([
      B({ status: "accepted" }),
      B({ id: "b0", blesserUid: "og", blesserUsername: "founder" }),
    ]);
    render(<BlessedByLine uid="me" onViewPlayer={onView} />);
    expect(await screen.findByTestId("blessed-by")).toHaveTextContent("PUT ON BY @bryanherman");
    expect(screen.getByText(/Real deal ripper/)).toBeInTheDocument();
    expect(screen.getByTestId("blessing-lineage")).toHaveTextContent("@bryanherman ← @founder");
    await userEvent.click(screen.getByRole("button", { name: "@bryanherman" }));
    expect(onView).toHaveBeenCalledWith("pro");
  });

  it("renders nothing for a seeded pro or a failed read", async () => {
    mockLineage.mockRejectedValue(new Error("x"));
    const { container } = render(<BlessedByLine uid="me" />);
    await waitFor(() => expect(mockLineage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the name without a link when no handler is given", async () => {
    mockLineage.mockResolvedValue([B({ reason: "", createdAtMs: 0 })]);
    render(<BlessedByLine uid="me" />);
    expect(await screen.findByTestId("blessed-by")).toHaveTextContent("@bryanherman");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("BlessingHero", () => {
  it("is the headline card and lists blessings when live", async () => {
    mockMine.mockResolvedValue([B({ status: "accepted" }), B({ id: "b2", targetUsername: "kid", status: "pending" })]);
    render(<BlessingHero uid="pro" live />);
    expect(screen.getByRole("heading", { name: "Put someone on" })).toBeInTheDocument();
    expect(await screen.findByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Waiting on them")).toBeInTheDocument();
  });

  it("previews without reading in review mode", () => {
    render(<BlessingHero uid="pro" live={false} />);
    expect(screen.getByText(/Preview/)).toBeInTheDocument();
    expect(mockMine).not.toHaveBeenCalled();
  });
});

describe("TurnedProGate", () => {
  it("renders nothing until a blessing arrives", () => {
    const { container } = render(<TurnedProGate uid="me" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("accept shows the turned-pro celebration, then refreshes on dismiss", async () => {
    const onTurnedPro = vi.fn();
    mockAnswer.mockResolvedValue("accepted");
    render(<TurnedProGate uid="me" onTurnedPro={onTurnedPro} />);
    act(() => pendingCb?.([B()]));
    expect(screen.getByTestId("blessing-offer")).toHaveTextContent("@bryanherman put you on as PRO");
    await userEvent.click(screen.getByTestId("blessing-accept"));
    expect(mockAnswer).toHaveBeenCalledWith("b1", true);
    expect(await screen.findByTestId("turned-pro-celebration")).toHaveTextContent("You're on.");
    expect(onTurnedPro).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "GOT IT" }));
    expect(onTurnedPro).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("decline closes quietly; errors stay on screen", async () => {
    mockAnswer.mockRejectedValueOnce(new Error("blesser_not_pro")).mockResolvedValueOnce("declined");
    render(<TurnedProGate uid="me" />);
    act(() => pendingCb?.([B()]));
    await userEvent.click(screen.getByTestId("blessing-accept"));
    expect(await screen.findByRole("alert")).toHaveTextContent("msg:blesser_not_pro");
    await userEvent.click(screen.getByTestId("blessing-decline"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
