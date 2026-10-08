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

/** jsdom has no scrollingElement. Install one for the duration of a test. */
function stubScrollingElement(value: Element | null): void {
  Object.defineProperty(document, "scrollingElement", { configurable: true, get: () => value });
}

describe("ScrollToTop", () => {
  it("resets the window and inner scroll roots when the path changes", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const scroller = document.createElement("div");
    scroller.scrollTop = 180;
    stubScrollingElement(scroller);
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
    expect(scroller.scrollTop).toBe(0);
    expect(root?.scrollTop).toBe(0);
    Reflect.deleteProperty(document, "scrollingElement");
    scrollTo.mockRestore();
  });

  it("still resets the window when the document has no scrolling element", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    stubScrollingElement(null);
    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <ScrollToTop />
        <Routes>
          <Route path="/lobby" element={<p>Lobby</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    Reflect.deleteProperty(document, "scrollingElement");
    scrollTo.mockRestore();
  });
});
