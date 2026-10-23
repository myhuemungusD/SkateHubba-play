import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

// The real ReportModal and ConfirmSheet this time (the sibling test mocks the
// modal): what matters here is where they land in the DOM and where focus
// goes afterwards, inside the same .glass header the profile renders them in.
vi.mock("../../../../services/reports", () => ({
  submitReport: vi.fn().mockResolvedValue("r1"),
  REPORT_REASON_LABELS: { spam: "Spam" },
}));

import { PlayerSafetyMenu } from "../PlayerSafetyMenu";

function InGlassHeader() {
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  return (
    <header className="glass">
      <PlayerSafetyMenu
        reporterUid="me"
        reportedUid="them"
        username="nyjah"
        isBlocked={false}
        blockLoading={false}
        showBlockConfirm={showBlockConfirm}
        onOpenBlockConfirm={() => setShowBlockConfirm(true)}
        onCancelBlockConfirm={() => setShowBlockConfirm(false)}
        onConfirmBlock={vi.fn()}
        onUnblock={vi.fn()}
      />
    </header>
  );
}

describe("PlayerSafetyMenu in the profile header", () => {
  it("portals Report out of the .glass header and hands focus back to ••• when it closes", async () => {
    const user = userEvent.setup();
    const { container } = render(<InGlassHeader />);
    const more = screen.getByRole("button", { name: "More options for @nyjah" });

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog", { name: /report/i });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(more);
  });

  it("hands focus back to ••• after Cancel on the menu and on the block confirm", async () => {
    const user = userEvent.setup();
    const { container } = render(<InGlassHeader />);
    const more = screen.getByRole("button", { name: "More options for @nyjah" });

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(more);

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Block" }));
    const confirm = screen.getByRole("alertdialog", { name: "Block @nyjah?" });
    expect(container.contains(confirm)).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(more);
  });
});
