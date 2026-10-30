import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { BootAuth } from "../BootAuth";
import {
  __resetLandingBootForTest,
  hasBootAppleSignIn,
  hasBootGoogleSignIn,
  peekBootAuthDraft,
  peekBootAuthMode,
} from "../landingBoot";

function Path() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function mountShell() {
  return render(
    <MemoryRouter initialEntries={["/auth"]}>
      <Routes>
        <Route path="*" element={<BootAuth />} />
      </Routes>
      <Path />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetLandingBootForTest();
});

describe("BootAuth", () => {
  it("records every signup field in the boot draft and swallows submit", async () => {
    const { container } = mountShell();
    await userEvent.type(screen.getByLabelText("Password"), "pw12");
    await userEvent.type(screen.getByLabelText("Confirm"), "pw12");
    await userEvent.type(screen.getByLabelText("Birth month"), "04");
    await userEvent.type(screen.getByLabelText("Birth day"), "09");
    await userEvent.type(screen.getByLabelText("Birth year"), "2001");
    expect(peekBootAuthDraft()).toMatchObject({
      password: "pw12",
      confirm: "pw12",
      month: "04",
      day: "09",
      year: "2001",
    });
    expect(screen.getByLabelText("Birth year")).toHaveValue("2001");

    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/auth");
    const form = container.querySelector("form");
    expect(form).not.toHaveAttribute("aria-busy");
    expect(form?.className).not.toContain("opacity-40");
  });

  it("toggles between signup and sign-in and remembers the mode", async () => {
    mountShell();
    await userEvent.click(screen.getByRole("button", { name: /Already have an account\?/ }));
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Birth month")).not.toBeInTheDocument();
    expect(peekBootAuthMode()).toBe("signin");

    await userEvent.click(screen.getByRole("button", { name: /Need an account\?/ }));
    expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
    expect(peekBootAuthMode()).toBe("signup");
  });

  it("Apple sign-in queues the intent, disables Google and dims the form", async () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    const { container } = mountShell();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(hasBootAppleSignIn()).toBe(true);
    expect(hasBootGoogleSignIn()).toBe(false);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(form?.className).toContain("opacity-40");
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDisabled();
  });

  it("Google sign-in queues the intent and disables Apple while it is pending", async () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    mountShell();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(hasBootGoogleSignIn()).toBe(true);
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeInTheDocument();
  });
});
