import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const modal = vi.hoisted(() => vi.fn());

vi.mock("../../../../components/ReportModal", () => ({
  ReportModal: (props: { onClose: () => void; onSubmitted: () => void }) => {
    modal(props);
    return (
      <div role="dialog" aria-label="Report">
        <button type="button" onClick={props.onClose}>
          cancel
        </button>
        <button type="button" onClick={props.onSubmitted}>
          done
        </button>
      </div>
    );
  },
}));

import { PlayerSafetyMenu } from "../PlayerSafetyMenu";

function props(overrides: Partial<Parameters<typeof PlayerSafetyMenu>[0]> = {}) {
  return {
    reporterUid: "me",
    reportedUid: "them",
    username: "nyjah",
    isBlocked: false,
    blockLoading: false,
    showBlockConfirm: false,
    onOpenBlockConfirm: vi.fn(),
    onCancelBlockConfirm: vi.fn(),
    onConfirmBlock: vi.fn(),
    onUnblock: vi.fn(),
    ...overrides,
  };
}

const openMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "More options for @nyjah" }));

describe("PlayerSafetyMenu", () => {
  it("opens a profile report for the viewed player and closes on cancel or submit", async () => {
    const user = userEvent.setup();
    render(<PlayerSafetyMenu {...props()} />);

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Report" }));
    await screen.findByRole("dialog", { name: "Report" });
    expect(modal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reporterUid: "me",
        reportedUid: "them",
        reportedUsername: "nyjah",
        gameId: null,
        profile: true,
      }),
    );
    await user.click(screen.getByText("cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Report" }));
    await user.click(await screen.findByText("done"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks to confirm a block, and wires Block and Cancel", async () => {
    const user = userEvent.setup();
    const p = props();
    const { rerender } = render(<PlayerSafetyMenu {...p} />);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(p.onOpenBlockConfirm).toHaveBeenCalledTimes(1);

    rerender(<PlayerSafetyMenu {...p} showBlockConfirm />);
    const confirm = screen.getByRole("alertdialog", { name: "Block @nyjah?" });
    expect(confirm).toHaveTextContent("They won't be able to challenge you, and you won't see their clips.");
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(p.onConfirmBlock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancelBlockConfirm).toHaveBeenCalledTimes(1);

    rerender(<PlayerSafetyMenu {...p} showBlockConfirm blockLoading />);
    expect(screen.getByRole("button", { name: "Blocking…" })).toBeInTheDocument();
  });

  it("offers Unblock once blocked, disabled while the write is in flight", async () => {
    const user = userEvent.setup();
    const p = props({ isBlocked: true, showBlockConfirm: true });
    const { rerender } = render(<PlayerSafetyMenu {...p} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await openMenu(user);
    expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unblock" }));
    expect(p.onUnblock).toHaveBeenCalledTimes(1);

    rerender(<PlayerSafetyMenu {...p} blockLoading />);
    await openMenu(user);
    expect(screen.getByRole("button", { name: "Unblock" })).toBeDisabled();
  });
});
