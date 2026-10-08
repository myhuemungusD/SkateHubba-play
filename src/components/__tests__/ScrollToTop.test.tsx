import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "../ScrollToTop";

function Jump() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/gameover")}>
      recap
    </button>
  );
}

describe("ScrollToTop", () => {
  it("resets the window and inner scroll roots when the path changes", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(document.documentElement, "scrollTop", { value: 400, writable: true, configurable: true });
    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <ScrollToTop />
        <div data-scroll-root />
        <Routes>
          <Route path="/lobby" element={<Jump />} />
          <Route path="/gameover" element={<p>You Win</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const root = document.querySelector<HTMLElement>("[data-scroll-root]");
    expect(root).not.toBeNull();
    if (root) root.scrollTop = 240;

    scrollTo.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "recap" }));

    expect(screen.getByText("You Win")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(root?.scrollTop).toBe(0);
    scrollTo.mockRestore();
  });
});
