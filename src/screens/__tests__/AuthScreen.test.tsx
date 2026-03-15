import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthScreen } from "../AuthScreen";

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockResetPassword = vi.fn();

vi.mock("../../services/auth", () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
}));

beforeEach(() => vi.clearAllMocks());

const defaultProps = {
  mode: "signin" as const,
  onDone: vi.fn(),
  onToggle: vi.fn(),
  onGoogle: vi.fn(),
  googleLoading: false,
  googleError: "",
};

describe("AuthScreen", () => {
  it("shows generic error for unknown auth error codes", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/some-unknown-code" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  it("shows error for account-exists-with-different-credential", async () => {
    mockSignUp.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    render(<AuthScreen {...defaultProps} mode="signup" />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    const pws = screen.getAllByPlaceholderText(/•/);
    await userEvent.type(pws[0], "password123");
    await userEvent.type(pws[1], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText(/linked to Google/)).toBeInTheDocument();
    });
  });

  it("shows error for wrong-password code", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/wrong-password" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
  });

  it("shows error for weak-password code", async () => {
    mockSignUp.mockRejectedValueOnce({ code: "auth/weak-password" });
    render(<AuthScreen {...defaultProps} mode="signup" />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    const pws = screen.getAllByPlaceholderText(/•/);
    await userEvent.type(pws[0], "123456");
    await userEvent.type(pws[1], "123456");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText("Password too weak (6+ chars)")).toBeInTheDocument();
    });
  });

  it("shows Error.message for non-code Error objects", async () => {
    mockSignIn.mockRejectedValueOnce(new Error("Custom auth failure"));
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Custom auth failure")).toBeInTheDocument();
    });
  });

  it("shows non-Error thrown fallback", async () => {
    mockSignIn.mockRejectedValueOnce("string error");
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  it("password reset requires email", async () => {
    render(<AuthScreen {...defaultProps} />);
    await userEvent.click(screen.getByText("Forgot password?"));
    expect(screen.getByText("Enter your email first")).toBeInTheDocument();
  });

  it("password reset handles failure silently", async () => {
    mockResetPassword.mockRejectedValueOnce(new Error("fail"));
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.click(screen.getByText("Forgot password?"));

    await waitFor(() => {
      expect(screen.getByText(/Reset email sent/)).toBeInTheDocument();
    });
  });

  it("form has reduced opacity when googleLoading", () => {
    render(<AuthScreen {...defaultProps} googleLoading={true} />);
    const form = screen.getByPlaceholderText("you@email.com").closest("form");
    expect(form?.className).toContain("opacity-40");
  });

  it("displays googleError", () => {
    render(<AuthScreen {...defaultProps} googleError="Google auth failed" />);
    expect(screen.getByText("Google auth failed")).toBeInTheDocument();
  });

  it("password strength indicator shows for signup", async () => {
    render(<AuthScreen {...defaultProps} mode="signup" />);

    const pw = screen.getAllByPlaceholderText(/•/)[0];
    await userEvent.type(pw, "abcdef");

    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("password strength shows Strong for complex password", async () => {
    render(<AuthScreen {...defaultProps} mode="signup" />);

    const pw = screen.getAllByPlaceholderText(/•/)[0];
    await userEvent.type(pw, "Abcdefghijk!1");

    expect(screen.getByText("Strong")).toBeInTheDocument();
  });
});
