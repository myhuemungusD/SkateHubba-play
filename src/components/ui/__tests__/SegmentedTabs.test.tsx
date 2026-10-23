import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SegmentedTabs } from "../SegmentedTabs";

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
] as const;
type Id = (typeof TABS)[number]["id"];

function Harness({ onChange }: { onChange?: (id: Id) => void }) {
  const [value, setValue] = useState<Id>("a");
  return (
    <SegmentedTabs
      tabs={TABS}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      label="Pick one"
      idPrefix="t"
    />
  );
}

describe("SegmentedTabs", () => {
  it("renders a named tablist with one selected tab and one tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Pick one" })).toBeInTheDocument();
    const [a, b] = screen.getAllByRole("tab");
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(a).toHaveAttribute("id", "t-tab-a");
    expect(a).toHaveAttribute("aria-controls", "t-panel");
    expect(b).toHaveAttribute("aria-selected", "false");
    expect(b).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves selection and focus with the arrow keys, wrapping at both ends", async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
  });
});
