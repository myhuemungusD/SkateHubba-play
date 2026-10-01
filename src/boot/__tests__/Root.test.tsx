import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Root } from "../Root";
import { __resetLandingBootForTest, releaseBootShell, setLandingBooted } from "../landingBoot";

// Capture the "landing painted" callback so each test decides when it fires.
const painted = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock("../landingBoot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../landingBoot")>()),
  afterLandingPainted: (cb: () => void) => {
    painted.cb = cb;
  },
}));

function FakeApp() {
  return <p>full app</p>;
}

const renderRoot = (boot: boolean, loadApp: () => Promise<{ default: () => ReactElement }>) =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Root boot={boot} loadApp={loadApp} />
    </MemoryRouter>,
  );

beforeEach(() => {
  painted.cb = null;
  __resetLandingBootForTest();
});

describe("Root", () => {
  it("normal path: spinner, App import starts immediately, then the App", async () => {
    const loadApp = vi.fn().mockResolvedValue({ default: FakeApp });
    renderRoot(false, loadApp);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(loadApp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("full app")).toBeInTheDocument();
  });

  it("boot path: paints the landing and loads App only after it has painted", async () => {
    setLandingBooted(true);
    const loadApp = vi.fn().mockResolvedValue({ default: FakeApp });
    renderRoot(true, loadApp);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("SKATEHUBBA");
    expect(loadApp).not.toHaveBeenCalled();
    act(() => painted.cb?.());
    expect(loadApp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("full app")).toBeInTheDocument();
    // The same boot landing stays mounted alongside App until App releases it.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("SKATEHUBBA");
    act(() => releaseBootShell());
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("full app")).toBeInTheDocument();
  });

  it("offers a reload when the App chunk fails to load", async () => {
    const reload = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
    try {
      renderRoot(false, vi.fn().mockRejectedValue(new Error("chunk 404")));
      await userEvent.click(await screen.findByRole("button", { name: "Reload" }));
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't finish loading");
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  });

  it("ignores a late result after unmount", async () => {
    let resolve!: (m: { default: () => ReactElement }) => void;
    let reject!: (e: unknown) => void;
    const ok = renderRoot(false, () => new Promise((r) => (resolve = r)));
    ok.unmount();
    resolve({ default: FakeApp });
    const bad = renderRoot(false, () => new Promise((_r, j) => (reject = j)));
    bad.unmount();
    reject(new Error("late"));
    await waitFor(() => expect(screen.queryByText("full app")).not.toBeInTheDocument());
  });
});
