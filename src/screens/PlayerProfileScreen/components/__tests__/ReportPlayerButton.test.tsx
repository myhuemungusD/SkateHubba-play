import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const modal = vi.hoisted(() => vi.fn());

vi.mock("../../../../components/ReportModal", () => ({
  ReportModal: (props: { onClose: () => void; onSubmitted: () => void }) => {
    modal(props);
    return (
      <div role="dialog">
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

import { ReportPlayerButton } from "../ReportPlayerButton";

describe("ReportPlayerButton", () => {
  it("opens a profile report for the viewed player and closes on cancel or submit", async () => {
    const user = userEvent.setup();
    render(<ReportPlayerButton reporterUid="me" reportedUid="them" username="nyjah" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report this player" }));
    await screen.findByRole("dialog");
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

    await user.click(screen.getByRole("button", { name: "Report this player" }));
    await user.click(await screen.findByText("done"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
