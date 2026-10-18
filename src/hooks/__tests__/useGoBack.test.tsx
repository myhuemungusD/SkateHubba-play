import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { canGoBackInApp, useGoBack } from "../useGoBack";

function Pushed() {
  const back = useGoBack("/lobby");
  return (
    <button type="button" onClick={back}>
      go back
    </button>
  );
}

function app(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/pushed" element={<Pushed />} />
        <Route path="/lobby" element={<p>home</p>} />
        <Route path="/feed" element={<p>feed</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("useGoBack", () => {
  it("knows the first history entry has nothing to pop", () => {
    expect(canGoBackInApp("default")).toBe(false);
    expect(canGoBackInApp("abc123")).toBe(true);
  });

  it("falls back to home on a deep link or refresh", async () => {
    app(["/pushed"]);
    await userEvent.click(screen.getByText("go back"));
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("pops in-app history, like swipe-back", async () => {
    render(
      <MemoryRouter initialEntries={["/feed"]}>
        <Routes>
          <Route path="/feed" element={<Opener />} />
          <Route path="/pushed" element={<Pushed />} />
          <Route path="/lobby" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("open"));
    await userEvent.click(screen.getByText("go back"));
    expect(screen.getByText("open")).toBeInTheDocument();
  });
});

function Opener() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate("/pushed")}>
      open
    </button>
  );
}
