import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, type RefObject } from "react";
import { useFocusTrap } from "../useFocusTrap";

function TrapFixture({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref}>
      <button>First</button>
      <button>Middle</button>
      <button>Last</button>
    </div>
  );
}

function NullRefFixture() {
  const ref = { current: null } as RefObject<HTMLDivElement | null>;
  useFocusTrap(ref);
  return <div>null ref</div>;
}

function EmptyTrapFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref}>
      <span>No focusable elements</span>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("wraps focus from last to first on Tab", async () => {
    render(<TrapFixture />);
    const last = screen.getByText("Last");
    last.focus();
    await userEvent.tab();
    expect(screen.getByText("First")).toHaveFocus();
  });

  it("wraps focus from first to last on Shift+Tab", async () => {
    render(<TrapFixture />);
    const first = screen.getByText("First");
    first.focus();
    await userEvent.tab({ shift: true });
    expect(screen.getByText("Last")).toHaveFocus();
  });

  it("does not trap when inactive", async () => {
    render(<TrapFixture active={false} />);
    const last = screen.getByText("Last");
    last.focus();
    await userEvent.tab();
    expect(screen.getByText("First")).not.toHaveFocus();
  });

  it("allows Tab between middle elements without wrapping", async () => {
    render(<TrapFixture />);
    const first = screen.getByText("First");
    first.focus();
    await userEvent.tab();
    expect(screen.getByText("Middle")).toHaveFocus();
  });

  it("ignores non-Tab keydown events", () => {
    render(<TrapFixture />);
    const first = screen.getByText("First");
    first.focus();
    fireEvent.keyDown(first.parentElement!, { key: "Enter" });
    expect(first).toHaveFocus();
  });

  it("allows Shift+Tab between middle elements without wrapping", () => {
    render(<TrapFixture />);
    const middle = screen.getByText("Middle");
    middle.focus();
    // Shift+Tab from middle should NOT wrap (activeElement is not first)
    fireEvent.keyDown(middle.parentElement!, { key: "Tab", shiftKey: true });
    // Focus handling is left to the browser; we just ensure no wrapping occurred
    expect(screen.getByText("Middle")).toHaveFocus();
  });

  it("handles container with no focusable children gracefully", () => {
    render(<EmptyTrapFixture />);
    const span = screen.getByText("No focusable elements");
    fireEvent.keyDown(span.parentElement!, { key: "Tab" });
    // Should not throw
  });

  it("handles null ref gracefully", () => {
    // Should not throw when ref.current is null
    render(<NullRefFixture />);
    expect(screen.getByText("null ref")).toBeInTheDocument();
  });
});
