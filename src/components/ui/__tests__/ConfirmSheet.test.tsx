import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmSheet } from "../ConfirmSheet";

function renderSheet(busy?: boolean) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmSheet
      title="Block skater?"
      body="They won't be able to challenge you."
      confirmLabel={busy ? "Blocking…" : "Block"}
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      busy={busy}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmSheet", () => {
  it("renders into <body>, not inside its caller (a .glass header would trap position:fixed)", () => {
    const { container } = render(
      <header className="glass">
        <ConfirmSheet title="t" body="b" confirmLabel="Block" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </header>,
    );
    const sheet = screen.getByRole("alertdialog");
    expect(container.contains(sheet)).toBe(false);
    expect(sheet.parentElement).toBe(document.body);
  });

  it("fires confirm and cancel, with focus rings on both buttons", async () => {
    const { onConfirm, onCancel } = renderSheet();
    const confirm = screen.getByRole("button", { name: "Block" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(confirm.className).toContain("focus-visible:outline-brand-orange");
    expect(cancel.className).toContain("focus-visible:outline-brand-orange");
    expect(cancel.className).toContain("text-background");
    await userEvent.click(confirm);
    await userEvent.click(cancel);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables confirm and sets aria-busy while busy, so a double-tap can't fire twice", async () => {
    const { onConfirm } = renderSheet(true);
    const confirm = screen.getByRole("button", { name: "Blocking…" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
