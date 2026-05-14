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

const mockSignInAttempt = vi.fn();
const mockSignInFailure = vi.fn();
const mockSignInSuccess = vi.fn();
const mockSignUpAttempt = vi.fn();
const mockSignUpFailure = vi.fn();
const mockSignUpSuccess = vi.fn();

vi.mock("../../services/analytics", () => ({
  analytics: {
    signIn: (...args: unknown[]) => mockSignInSuccess(...args),
    signInAttempt: (...args: unknown[]) => mockSignInAttempt(...args),
    signInFailure: (...args: unknown[]) => mockSignInFailure(...args),
    signUp: (...args: unknown[]) => mockSignUpSuccess(...args),
    signUpAttempt: (...args: unknown[]) => mockSignUpAttempt(...args),
    signUpFailure: (...args: unknown[]) => mockSignUpFailure(...args),
  },
}));

const mockMetricSignIn = vi.fn();
const mockMetricSignInAttempt = vi.fn();
const mockMetricSignInFailure = vi.fn();
const mockMetricSignUp = vi.fn();
const mockMetricSignUpAttempt = vi.fn();
const mockMetricSignUpFailure = vi.fn();

vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  metrics: {
    signIn: (...args: unknown[]) => mockMetricSignIn(...args),
    signInAttempt: (...args: unknown[]) => mockMetricSignInAttempt(...args),
    signInFailure: (...args: unknown[]) => mockMetricSignInFailure(...args),
    signUp: (...args: unknown[]) => mockMetricSignUp(...args),
    signUpAttempt: (...args: unknown[]) => mockMetricSignUpAttempt(...args),
    signUpFailure: (...args: unknown[]) => mockMetricSignUpFailure(...args),
  },
}));

const mockCaptureException = vi.fn();
vi.mock("../../lib/sentry", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

beforeEach(() => vi.clearAllMocks());

const defaultProps = {
  mode: "signin" as const,
  onDone: vi.fn(),
  onToggle: vi.fn(),
  onGoogle: vi.fn(),
  googleLoading: false,
  googleError: "",
  onGoogleErrorDismiss: vi.fn(),
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

  it("shows retry message for auth/internal-error", async () => {
    // Firebase wraps Identity Toolkit failures (App Check rejections, reCAPTCHA
    // outages, transient 500s) into this catch-all code — don't leak "Firebase:
    // Error (auth/internal-error)." to the user.
    mockSignIn.mockRejectedValueOnce({
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error).",
    });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign-in is temporarily unavailable/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/auth\/internal-error/)).not.toBeInTheDocument();
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
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(form).toHaveClass("opacity-40");
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

  it("shows rate-limit error for auth/too-many-requests", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/too-many-requests" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/Too many attempts/)).toBeInTheDocument();
    });
  });

  it("shows network error for auth/network-request-failed", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it("shows clear copy for auth/user-disabled (existing account, can't sign in)", async () => {
    // Bryan's failure-mode neighbour: existing user whose account was disabled
    // — used to fall through the generic else branch and surface the raw
    // "Firebase: Error (auth/user-disabled)." message.
    mockSignIn.mockRejectedValueOnce({ code: "auth/user-disabled" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/This account has been disabled/)).toBeInTheDocument();
    });
  });

  it("shows session-expired copy for auth/user-token-expired", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/user-token-expired" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/Your session expired/)).toBeInTheDocument();
    });
  });

  it("shows actionable copy for auth/web-storage-unsupported (Safari private mode)", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/web-storage-unsupported" });
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText(/browser is blocking storage/i)).toBeInTheDocument();
    });
  });

  it("surfaces inline 'Sign in instead' action when signup hits auth/email-already-in-use", async () => {
    // The single highest-leverage UX fix: returning users (Bryan) who got
    // pushed into signup hit "email already in use" and previously had to
    // find a small text-link toggle at the bottom of the form to switch to
    // sign-in — which used to remount the form and wipe their typed email.
    // Now we surface a prominent inline button that switches mode without
    // clearing input.
    mockSignUp.mockRejectedValueOnce({ code: "auth/email-already-in-use" });
    const onToggle = vi.fn();
    render(<AuthScreen {...defaultProps} mode="signup" onToggle={onToggle} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "bryan@test.com");
    const pws = screen.getAllByPlaceholderText(/•/);
    await userEvent.type(pws[0], "password123");
    await userEvent.type(pws[1], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText(/Looks like you already have an account/)).toBeInTheDocument();
    });
    const recover = screen.getByRole("button", { name: /Sign in with this email instead/ });
    expect(recover).toBeInTheDocument();
    await userEvent.click(recover);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("surfaces inline 'Forgot password?' action on auth/invalid-credential during sign-in", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/invalid-credential" });
    mockResetPassword.mockResolvedValueOnce(undefined);
    render(<AuthScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    const recover = await screen.findByRole("button", { name: /Forgot password\? Send reset email/ });
    await userEvent.click(recover);

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith("user@test.com");
      expect(screen.getByText(/Reset email sent/)).toBeInTheDocument();
    });
  });

  it("clears the inline recovery button when the surfaced error is dismissed", async () => {
    mockSignUp.mockRejectedValueOnce({ code: "auth/email-already-in-use" });
    render(<AuthScreen {...defaultProps} mode="signup" />);

    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "bryan@test.com");
    const pws = screen.getAllByPlaceholderText(/•/);
    await userEvent.type(pws[0], "password123");
    await userEvent.type(pws[1], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await screen.findByRole("button", { name: /Sign in with this email instead/ });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

    expect(screen.queryByRole("button", { name: /Sign in with this email instead/ })).not.toBeInTheDocument();
  });

  it("preserves typed email + password when the parent toggles mode", async () => {
    // App.tsx no longer remounts the screen via `key={authMode}` when the
    // user toggles sign-in <-> sign-up — the screen must reset only the
    // transient one-shot state (errors, verification warnings) while keeping
    // the user's typed credentials so they don't have to retype on switch.
    const { rerender } = render(<AuthScreen {...defaultProps} mode="signin" />);
    await userEvent.type(screen.getByPlaceholderText("you@email.com"), "bryan@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");

    rerender(<AuthScreen {...defaultProps} mode="signup" />);

    expect((screen.getByPlaceholderText("you@email.com") as HTMLInputElement).value).toBe("bryan@test.com");
    // Both password fields (Password + Confirm) appear in signup mode — only
    // the first (Password) should still carry the value the user typed.
    const pws = screen.getAllByPlaceholderText(/•/) as HTMLInputElement[];
    expect(pws[0].value).toBe("password123");
  });

  describe("auth telemetry (outage detection)", () => {
    it("fires sign_in_attempt + sign_in success on successful email sign-in", async () => {
      mockSignIn.mockResolvedValueOnce({ uid: "uid-success" });
      render(<AuthScreen {...defaultProps} />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

      await waitFor(() => expect(mockSignInSuccess).toHaveBeenCalledWith("email"));
      expect(mockSignInAttempt).toHaveBeenCalledWith("email");
      expect(mockMetricSignInAttempt).toHaveBeenCalledWith("email");
      expect(mockMetricSignIn).toHaveBeenCalledWith("email", "uid-success");
      expect(mockSignInFailure).not.toHaveBeenCalled();
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("fires sign_up_attempt + sign_up success on successful email sign-up", async () => {
      mockSignUp.mockResolvedValueOnce({
        user: { uid: "uid-newaccount" },
        verificationEmailSent: true,
      });
      render(<AuthScreen {...defaultProps} mode="signup" />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      const pws = screen.getAllByPlaceholderText(/•/);
      await userEvent.type(pws[0], "password123");
      await userEvent.type(pws[1], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      await waitFor(() => expect(mockSignUpSuccess).toHaveBeenCalledWith("email"));
      expect(mockSignUpAttempt).toHaveBeenCalledWith("email");
      expect(mockMetricSignUpAttempt).toHaveBeenCalledWith("email");
      expect(mockMetricSignUp).toHaveBeenCalledWith("email", "uid-newaccount");
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("does NOT capture benign user-errors to Sentry (wrong password)", async () => {
      mockSignIn.mockRejectedValueOnce({ code: "auth/wrong-password" });
      render(<AuthScreen {...defaultProps} />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

      await waitFor(() => expect(mockSignInFailure).toHaveBeenCalledWith("email", "auth/wrong-password"));
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("captures auth/internal-error to Sentry with context", async () => {
      const err = { code: "auth/internal-error", message: "Firebase: Error (auth/internal-error)." };
      mockSignIn.mockRejectedValueOnce(err);
      render(<AuthScreen {...defaultProps} />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

      await waitFor(() => expect(mockSignInFailure).toHaveBeenCalledWith("email", "auth/internal-error"));
      expect(mockCaptureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          extra: expect.objectContaining({
            context: "AuthScreen.submit",
            mode: "signin",
            code: "auth/internal-error",
          }),
        }),
      );
    });

    it("captures unknown codes to Sentry (escalate for investigation)", async () => {
      const err = { code: "auth/some-brand-new-code" };
      mockSignIn.mockRejectedValueOnce(err);
      render(<AuthScreen {...defaultProps} />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

      await waitFor(() => expect(mockCaptureException).toHaveBeenCalled());
      expect(mockSignInFailure).toHaveBeenCalledWith("email", "auth/some-brand-new-code");
    });

    it("falls back to 'unknown' code when error has no code field", async () => {
      mockSignIn.mockRejectedValueOnce(new Error("weird"));
      render(<AuthScreen {...defaultProps} />);

      await userEvent.type(screen.getByPlaceholderText("you@email.com"), "user@test.com");
      await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

      await waitFor(() => expect(mockSignInFailure).toHaveBeenCalledWith("email", "unknown"));
    });
  });

  describe("inline DOB (COPPA)", () => {
    const signupProps = {
      ...defaultProps,
      mode: "signup" as const,
      showAgeFields: true,
    };

    async function fillSignupForm(email = "new@test.com", pw = "password123") {
      await userEvent.type(screen.getByPlaceholderText("you@email.com"), email);
      const pws = screen.getAllByPlaceholderText(/•/);
      await userEvent.type(pws[0], pw);
      await userEvent.type(pws[1], pw);
    }

    it("renders DOB inputs only when showAgeFields is true", () => {
      render(<AuthScreen {...signupProps} />);
      expect(screen.getByLabelText("Birth month")).toBeInTheDocument();
      expect(screen.getByLabelText("Birth day")).toBeInTheDocument();
      expect(screen.getByLabelText("Birth year")).toBeInTheDocument();
    });

    it("does not render DOB inputs when showAgeFields is false", () => {
      render(<AuthScreen {...defaultProps} mode="signup" />);
      expect(screen.queryByLabelText("Birth month")).not.toBeInTheDocument();
    });

    it("does not render DOB inputs in signin mode even if showAgeFields=true", () => {
      render(<AuthScreen {...defaultProps} showAgeFields={true} />);
      expect(screen.queryByLabelText("Birth month")).not.toBeInTheDocument();
    });

    it("blocks under-13 signups with the inline COPPA card", async () => {
      const onAgeVerified = vi.fn();
      render(<AuthScreen {...signupProps} onAgeVerified={onAgeVerified} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "01");
      await userEvent.type(screen.getByLabelText("Birth year"), "2020");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      expect(screen.getByText("Sorry!")).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();
      expect(onAgeVerified).not.toHaveBeenCalled();
    });

    it("Go Back from the blocked card restores the signup form with cleared DOB", async () => {
      render(<AuthScreen {...signupProps} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "01");
      await userEvent.type(screen.getByLabelText("Birth year"), "2020");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      expect(screen.getByText("Sorry!")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Go Back" }));
      expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
      // Failing DOB is cleared so a new attempt doesn't re-block on the same inputs.
      expect((screen.getByLabelText("Birth month") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("Birth day") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("Birth year") as HTMLInputElement).value).toBe("");
    });

    it("requires parental consent for 13-17 year olds before submitting", async () => {
      render(<AuthScreen {...signupProps} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "01");
      await userEvent.type(screen.getByLabelText("Birth year"), "2011");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      expect(screen.getByText(/Parental or guardian consent is required/)).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("emits onAgeVerified with the DOB + consent flag before signUp", async () => {
      mockSignUp.mockResolvedValueOnce({ user: { uid: "u1" }, verificationEmailSent: true });
      const onAgeVerified = vi.fn();
      render(<AuthScreen {...signupProps} onAgeVerified={onAgeVerified} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "15");
      await userEvent.type(screen.getByLabelText("Birth year"), "2000");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
      expect(onAgeVerified).toHaveBeenCalledWith("2000-01-15", false);
      // onAgeVerified fires before signUp so context can stash the DOB for ProfileSetup.
      expect(onAgeVerified.mock.invocationCallOrder[0]).toBeLessThan(mockSignUp.mock.invocationCallOrder[0]);
    });

    it("passes parentalConsent=true to onAgeVerified when a minor confirms consent", async () => {
      mockSignUp.mockResolvedValueOnce({ user: { uid: "u1" }, verificationEmailSent: true });
      const onAgeVerified = vi.fn();
      render(<AuthScreen {...signupProps} onAgeVerified={onAgeVerified} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "01");
      await userEvent.type(screen.getByLabelText("Birth year"), "2011");
      await userEvent.click(screen.getByLabelText("Parental consent"));
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
      expect(onAgeVerified).toHaveBeenCalledWith("2011-01-01", true);
    });

    it("surfaces an invalid-date error without calling signUp", async () => {
      render(<AuthScreen {...signupProps} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "02");
      await userEvent.type(screen.getByLabelText("Birth day"), "30");
      await userEvent.type(screen.getByLabelText("Birth year"), "2000");
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      expect(screen.getByText("Please enter a valid date")).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("surfaces an empty-date error without calling signUp", async () => {
      render(<AuthScreen {...signupProps} />);
      await fillSignupForm();
      await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

      expect(screen.getByText(/Please enter your full date of birth/)).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("routes clicks on the minor consent legal links via onNavLegal", async () => {
      const onNavLegal = vi.fn();
      render(<AuthScreen {...signupProps} onNavLegal={onNavLegal} />);
      await fillSignupForm();
      await userEvent.type(screen.getByLabelText("Birth month"), "01");
      await userEvent.type(screen.getByLabelText("Birth day"), "01");
      await userEvent.type(screen.getByLabelText("Birth year"), "2011");

      await userEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
      await userEvent.click(screen.getByRole("button", { name: "Terms of Service" }));

      expect(onNavLegal).toHaveBeenNthCalledWith(1, "privacy");
      expect(onNavLegal).toHaveBeenNthCalledWith(2, "terms");
    });
  });
});
