import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { BootLanding } from "../BootLanding";
import {
  __resetLandingBootForTest,
  hasBootAppleSignIn,
  hasBootGoogleSignIn,
  peekBootAuthDraft,
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BootLanding", () => {
  it("shows the spinner off the fast path", () => {
    renderAt("/lobby");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("paints the auth shell copy before Firebase loads", () => {
    renderAt("/auth");
    expect(
      screen.getByText("Join the crew. It's free. We collect your DOB to comply with COPPA & CCPA."),
    ).toBeInTheDocument();
  });

  it("keeps typed auth-shell values for the handoff", async () => {
    renderAt("/auth");
    await userEvent.type(screen.getByLabelText("Email"), "skater@example.com");
    expect(peekBootAuthDraft().email).toBe("skater@example.com");
  });

  it("paints a feed poster so LCP is not the video", () => {
    renderAt("/feed");
    const poster = screen.getByRole("status", { name: "Loading clips" }).querySelector("img");
    expect(poster).toHaveAttribute("src", "/sh-video-poster.webp");
    expect(screen.getByRole("heading", { name: "Clips" })).toBeInTheDocument();
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

  it("hides Sign in with Apple on the boot landing when the flag is off", () => {
    renderAt("/");
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("Apple records the intent and shows the button as loading", async () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
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
