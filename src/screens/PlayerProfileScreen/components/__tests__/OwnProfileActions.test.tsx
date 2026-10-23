import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OwnProfileActions } from "../OwnProfileActions";

describe("OwnProfileActions", () => {
  it("makes Edit Profile the filled primary and the rest secondary, all with press feedback", () => {
    render(
      <OwnProfileActions
        onEditProfile={vi.fn()}
        onViewMyStats={vi.fn()}
        onShare={vi.fn()}
        shareCopied={false}
        onCustomize={vi.fn()}
      />,
    );
    expect(screen.getByTestId("edit-profile-button")).toHaveClass("btn-primary-fill", "press-feedback", "rounded-xl");
    for (const id of ["share-my-profile-button", "customize-profile-button", "my-stats-button"]) {
      const el = screen.getByTestId(id);
      expect(el).toHaveClass("btn-secondary", "press-feedback", "rounded-xl");
      expect(el).not.toHaveClass("btn-primary-fill");
    }
    expect(screen.getByTestId("my-stats-button")).toHaveClass("w-full");
  });

  it("wires each action and shows the copied state", () => {
    const onShare = vi.fn();
    const { rerender } = render(<OwnProfileActions onShare={onShare} shareCopied={false} />);
    expect(screen.queryByTestId("edit-profile-button")).toBeNull();
    expect(screen.queryByTestId("my-stats-button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share my profile" }));
    expect(onShare).toHaveBeenCalledTimes(1);
    rerender(<OwnProfileActions onShare={onShare} shareCopied />);
    expect(screen.getByTestId("share-my-profile-button")).toHaveTextContent("LINK COPIED");
  });
});
