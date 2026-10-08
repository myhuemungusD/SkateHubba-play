import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { BootLanding } from "../BootLanding";
import {
  __resetLandingBootForTest,
  hasBootAppleSignIn,
  hasBootGoogleSignIn,
  peekBootAuthMode,
  setLandingBridge,
} from "../landingBoot";

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<BootLanding />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetLandingBootForTest();
});

describe("BootLanding", () => {
  it("shows the spinner anywhere but the landing", () => {
    renderAt("/auth");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("Create account records signup mode and routes to /auth", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(peekBootAuthMode()).toBe("signup");
    expect(screen.getByTestId("path")).toHaveTextContent("/auth");
  });

  it("Sign in records signin mode", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(peekBootAuthMode()).toBe("signin");
  });

  it("Apple records the intent and shows the button as loading", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(hasBootAppleSignIn()).toBe(true);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("Google records the intent and shows the button as loading", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: /google/i }));
    expect(hasBootGoogleSignIn()).toBe(true);
    // googleLoading disables the email entry points until App takes over.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("routes the footer legal links", async () => {
    renderAt("/");
    await userEvent.click(screen.getByText("Privacy"));
    expect(screen.getByTestId("path")).toHaveTextContent("/privacy");
  });

  it("switches to App's handlers once App publishes them, without remounting", async () => {
    renderAt("/");
    // In-page state the visitor created before App arrived…
    await userEvent.click(screen.getByRole("button", { name: /Invite a Friend/i }));
    expect(screen.getByRole("region", { name: /Invite a friend options/i })).toBeInTheDocument();
    const bridge = {
      onGo: vi.fn(),
      onGoogle: vi.fn(),
      googleLoading: false,
      onApple: vi.fn(),
      appleLoading: false,
      onNav: vi.fn(),
    };
    act(() => setLandingBridge(bridge));
    // …survives the handoff.
    expect(screen.getByRole("region", { name: /Invite a friend options/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(bridge.onGo).toHaveBeenCalledWith("signin");
    expect(peekBootAuthMode()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /google/i }));
    expect(bridge.onGoogle).toHaveBeenCalledTimes(1);
    expect(hasBootGoogleSignIn()).toBe(false);
  });
});
