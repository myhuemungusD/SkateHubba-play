import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSetup } from "../ProfileSetup";
import { markAgeGateBlocked, markCoppaBlocked } from "../../utils/coppaNotice";

const mockCreateProfile = vi.fn();
const mockGetUserProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();

// The error class needs to round-trip into the mocked module. Stash it via
// vi.hoisted so both the `new` call below and the mock factory reference the
// same constructor (factory runs before top-level classes initialize).
const { AgeVerificationRequiredError: MockAgeVerificationRequiredError } = vi.hoisted(() => {
  class AgeVerificationRequiredError extends Error {
    constructor() {
      super("Age verification required");
      this.name = "AgeVerificationRequiredError";
    }
  }
  return { AgeVerificationRequiredError };
});

vi.mock("../../services/users", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  // ProfileSetup now calls getUserProfileOnAuth(uid) directly — the
  // services layer resolves currentUser from the auth singleton itself,
  // so screens don't reach into firebase.ts. The mock just routes to
  // the shared spy.
  getUserProfileOnAuth: (uid: string) => mockGetUserProfile(uid),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  AgeVerificationRequiredError: MockAgeVerificationRequiredError,
  // ProfileSetup imports these shared validation constants — mirror the
  // real values so the mocked module still exports them.
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  USERNAME_RE: /^[a-z0-9_]+$/,
}));

const { mockBlockUnderage } = vi.hoisted(() => ({ mockBlockUnderage: vi.fn() }));
vi.mock("../../services/auth.underage", () => ({ blockUnderageSignIn: () => mockBlockUnderage() }));

/** Tick the required Terms checkbox (idempotent, so repeat submits keep it ticked). */
async function acceptTerms() {
  const box = screen.queryByTestId("terms-accept") as HTMLInputElement | null;
  if (box && !box.checked) await userEvent.click(box);
}

beforeEach(() => {
  vi.clearAllMocks();
  // An under-13 block is sticky for 24h on the device; don't let one test's block leak into the next.
  localStorage.clear();
  sessionStorage.clear();
  mockBlockUnderage.mockResolvedValue("deleted");
  // Default: new user with no existing profile
  mockGetUserProfile.mockResolvedValue(null);
});

describe("ProfileSetup", () => {
  const defaultProps = {
    uid: "u1",
    emailVerified: false,
    displayName: null,
    onDone: vi.fn(),
    // Email-signup path: DOB arrives as a prop so the form skips the inline
    // DOB row and goes straight to username + stance.
    dob: "2000-01-15",
    parentalConsent: false,
  };

  /** Wait for the existing-profile check to complete and the form to appear */
  async function waitForForm() {
    await waitFor(() => expect(screen.getByText("Pick your handle")).toBeInTheDocument());
  }

  /** Helper: type a valid available username and wait for the availability dot */
  async function typeAvailableUsername(username = "newuser") {
    mockIsUsernameAvailable.mockResolvedValue(true);
    await waitForForm();
    await userEvent.type(screen.getByPlaceholderText("sk8legend"), username);
    await waitFor(() => expect(screen.getByText(new RegExp(`@${username} is available`))).toBeInTheDocument());
  }

  /** Render with inline DOB collection and submit an under-13 birthday (Terms ticked). */
  async function submitUnder13Inline() {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2020");
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));
  }

  // ─── Terms agreement (App Review 1.2) ──────────────────────

  it("requires the Terms checkbox before creating the profile", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    const box = screen.getByTestId("terms-accept") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box).toHaveAttribute("aria-required", "true");

    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));
    expect(screen.getByText("Agree to the Terms and Privacy Policy to continue")).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();

    mockCreateProfile.mockResolvedValue({ uid: "u1", username: "newuser", stance: "Regular" });
    await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));
    await waitFor(() =>
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, "2000-01-15", false, true),
    );
  });

  it("links the Terms and Privacy Policy from the checkbox and routes them in-app", async () => {
    const onNavLegal = vi.fn();
    render(<ProfileSetup {...defaultProps} onNavLegal={onNavLegal} />);
    await waitForForm();
    const terms = screen.getByRole("link", { name: "Terms of Service" });
    const privacy = screen.getByRole("link", { name: "Privacy Policy" });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(screen.getByText(/Zero tolerance for objectionable content or abusive users/)).toBeInTheDocument();
    await userEvent.click(terms);
    await userEvent.click(privacy);
    expect(onNavLegal).toHaveBeenNthCalledWith(1, "terms");
    expect(onNavLegal).toHaveBeenNthCalledWith(2, "privacy");
  });

  it("never shows the setup form (or the Terms checkbox) to an existing account", async () => {
    // Accounts created before 1.2.0 have no termsAcceptedAt. They go straight
    // through, with no re-gate.
    const existing = { uid: "u1", username: "oldhead", stance: "Goofy" };
    mockGetUserProfile.mockResolvedValue(existing);
    const onDone = vi.fn();
    render(<ProfileSetup {...defaultProps} onDone={onDone} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(existing));
    expect(screen.queryByTestId("terms-accept")).not.toBeInTheDocument();
  });

  // ─── Single-card form ──────────────────────────────────────

  it("renders username + stance + submit on one card for the email-signup path", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    expect(screen.getByPlaceholderText("sk8legend")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Regular/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Goofy/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lock It In/ })).toBeInTheDocument();
    // DOB inputs are suppressed because `dob` is already populated.
    expect(screen.queryByLabelText("Birth month")).not.toBeInTheDocument();
  });

  it("submits with short username shows error", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "ab");

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText(/Username must be \d\+ characters/)).toBeInTheDocument();
  });

  it("enforces the maxLength attribute on the username input", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.maxLength).toBe(20);
  });

  it("submits with a taken username shows 'Username is taken'", async () => {
    mockIsUsernameAvailable.mockResolvedValue(false);
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "takenuser");

    await waitFor(() => expect(screen.getByText(/@takenuser is taken/)).toBeInTheDocument());

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username is taken")).toBeInTheDocument();
  });

  it("submits while availability check is pending shows waiting error", async () => {
    mockIsUsernameAvailable.mockImplementation(() => new Promise(() => {}));
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "checking");

    expect(screen.getByText("Checking...")).toBeInTheDocument();

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Still checking username — wait a moment")).toBeInTheDocument();
  });

  it("surfaces availability-check failures after retry", async () => {
    mockIsUsernameAvailable.mockRejectedValue(new Error("Network"));

    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "testname");

    // The component retries once after 1.5s before surfacing the error.
    await waitFor(
      () => {
        expect(screen.getByText("Could not check username — try again")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("lets the user submit when the availability probe errors (transaction is the real gate)", async () => {
    // Probe fails both attempts → useUsernameAvailability settles with
    // { available: null, error: "Could not check username — try again" }.
    // Previously canSubmit hard-required available === true so the user was
    // trapped — now we fall through to createProfile and let its transaction
    // be the canonical uniqueness check.
    mockIsUsernameAvailable.mockRejectedValue(new Error("Network"));
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "testname", stance: "Regular" };
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);
    await waitForForm();
    await userEvent.type(screen.getByPlaceholderText("sk8legend"), "testname");

    // Wait for the probe + retry to both fail — at that point the note stops
    // saying "Checking..." and the button becomes submittable.
    await waitFor(
      () => {
        expect(screen.getByText(/Couldn't verify/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    await acceptTerms();

    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "testname", "Regular", false, "2000-01-15", false, true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("uses displayName as the initial username value (sanitized)", async () => {
    render(<ProfileSetup {...defaultProps} displayName="Sk8 Master" />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.value).toBe("sk8master");
  });

  it("rejects usernames longer than the max on submit", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    // Bypass HTML maxLength via fireEvent so we can exercise the service-level guard.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "abcdefghijklmnopqrstuvwxyz" } });

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText(/Username too long \(max \d+\)/)).toBeInTheDocument();
  });

  it("lets the user toggle stance between Regular and Goofy", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    expect(screen.getByRole("radio", { name: /Regular/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: /Goofy/ }));
    expect(screen.getByRole("radio", { name: /Goofy/ })).toHaveAttribute("aria-checked", "true");
  });

  // ─── Submit + createProfile ────────────────────────────────

  it("forwards the supplied dob + consent to createProfile on success", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "newuser", stance: "Regular" };
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);
    await typeAvailableUsername();
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, "2000-01-15", false, true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("sends Goofy when the user picks the Goofy stance", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "newuser", stance: "Goofy" };
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);
    await typeAvailableUsername();
    await userEvent.click(screen.getByRole("radio", { name: /Goofy/ }));
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Goofy", false, "2000-01-15", false, true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("surfaces service-level errors when createProfile fails", async () => {
    mockCreateProfile.mockRejectedValueOnce(new Error("Write failed"));

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Write failed")).toBeInTheDocument());
  });

  it("falls back to a generic message when createProfile rejects with a non-Error", async () => {
    mockCreateProfile.mockRejectedValueOnce("string error");

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Could not create profile")).toBeInTheDocument());
  });

  it("shows the creating spinner while the submit is in flight", async () => {
    mockCreateProfile.mockImplementation(() => new Promise(() => {}));

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Creating...")).toBeInTheDocument());
  });

  it("skips setup when the user already has a profile", async () => {
    const onDone = vi.fn();
    const existingProfile = { uid: "u1", username: "existinguser", stance: "Goofy" };
    mockGetUserProfile.mockResolvedValue(existingProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(existingProfile));
    expect(mockGetUserProfile).toHaveBeenCalledWith("u1");
  });

  it("shows a retry screen (not the form) when the existing-profile lookup fails", async () => {
    // Returning users whose profile fetch errors transiently must NOT see the
    // create-profile form — that would invite them to re-register over their
    // own profile, which then fails at createProfile's transaction with a
    // confusing "Username is already taken" error.
    mockGetUserProfile.mockRejectedValue(new Error("Network error"));

    render(<ProfileSetup {...defaultProps} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load your profile/)).toBeInTheDocument());
    expect(screen.queryByText("Pick your handle")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("surfaces the Firestore error code on the retry screen for diagnostics", async () => {
    // Without surfacing the error, a user stuck on Retry has no clue
    // whether it's App Check, a network failure, or a token race. The
    // code tells us what to look at.
    const err = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    mockGetUserProfile.mockRejectedValue(err);

    render(<ProfileSetup {...defaultProps} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load your profile/)).toBeInTheDocument());
    expect(screen.getByText(/permission-denied/)).toBeInTheDocument();
    // Also surfaces the uid so operators can correlate with Firebase console.
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });

  it("flags permission-denied as an App Check / reCAPTCHA backend issue", async () => {
    // The generic "transient network hiccup" copy is wrong for
    // permission-denied — that's always a backend rule / App Check / DB
    // rejection the user can't retry their way out of. The special-cased
    // copy tells them what to actually do (try non-Incognito, contact
    // support) instead of hammering Retry for ten minutes.
    const err = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    mockGetUserProfile.mockRejectedValue(err);

    render(<ProfileSetup {...defaultProps} />);

    await waitFor(() => expect(screen.getByText(/App Check \/ reCAPTCHA configuration issue/i)).toBeInTheDocument());
    // Generic network copy is suppressed in the permission-denied branch.
    expect(screen.queryByText(/transient network hiccup/i)).not.toBeInTheDocument();
  });

  it("retries the existing-profile lookup when the user taps Retry", async () => {
    const onDone = vi.fn();
    const existingProfile = { uid: "u1", username: "returninguser", stance: "Goofy" };
    mockGetUserProfile.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce(existingProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load your profile/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(existingProfile));
    expect(mockGetUserProfile).toHaveBeenCalledTimes(2);
  });

  it("offers a Sign out escape hatch on the retry screen when onSignOut is wired", async () => {
    // If the profile lookup keeps failing the user must be able to get back
    // to the landing page — otherwise they're trapped with a dead Retry
    // button. App.tsx wires onSignOut to the auth handler.
    mockGetUserProfile.mockRejectedValue(new Error("Network error"));
    const onSignOut = vi.fn();

    render(<ProfileSetup {...defaultProps} onSignOut={onSignOut} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load your profile/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces an inline message when the service rejects for missing DOB", async () => {
    mockCreateProfile.mockRejectedValue(new MockAgeVerificationRequiredError());

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Please enter your date of birth to continue.")).toBeInTheDocument());
  });

  // ─── Inline DOB collection (Google-signup fallback) ────────

  it("renders inline DOB inputs when no dob prop is supplied", async () => {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await waitForForm();
    expect(screen.getByLabelText("Birth month")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth day")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth year")).toBeInTheDocument();
  });

  it("blocks users under 13 with the branded COPPA card when collecting DOB inline", async () => {
    await submitUnder13Inline();

    // Branded "Sorry!" card mirrors the email-signup block UX.
    expect(screen.getByRole("heading", { name: "Sorry!" })).toBeInTheDocument();
    expect(screen.getByText(/at least 13 years old/)).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();
    // COPPA: the Google/Apple Auth account made before the DOB step is removed.
    expect(mockBlockUnderage).toHaveBeenCalledTimes(1);
  });

  it("clears the failing DOB when the user taps Go Back on the blocked card", async () => {
    await submitUnder13Inline();

    expect(screen.getByRole("heading", { name: "Sorry!" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go Back" }));

    // Form returns with DOB inputs empty — username + stance persist.
    expect(screen.getByText("Pick your handle")).toBeInTheDocument();
    expect((screen.getByLabelText("Birth month") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Birth day") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Birth year") as HTMLInputElement).value).toBe("");
    expect((screen.getByPlaceholderText("sk8legend") as HTMLInputElement).value).toBe("newuser");
  });

  it("re-blocks and re-runs the sign-in removal after Go Back, whatever DOB comes next", async () => {
    await submitUnder13Inline();
    await userEvent.click(screen.getByRole("button", { name: "Go Back" }));
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "15");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    expect(screen.getByRole("heading", { name: "Sorry!" })).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();
    expect(mockBlockUnderage).toHaveBeenCalledTimes(2);
  });

  it("states the deletion outcome on its blocked card", async () => {
    await submitUnder13Inline();
    // blockUnderageSignIn is mocked, so no notice is stored: the card says pending, never "removed".
    expect(screen.getByText(/will be deleted/)).toBeInTheDocument();
    act(() => markCoppaBlocked("deleted"));
    expect(screen.getByText(/has been removed/)).toBeInTheDocument();
  });

  it("retries a pending removal on open while the 24h block is set, once no profile is confirmed", async () => {
    markAgeGateBlocked();
    let resolveLookup: (p: null) => void = () => {};
    mockGetUserProfile.mockReturnValueOnce(new Promise((r) => (resolveLookup = r)));
    render(<ProfileSetup {...defaultProps} dob={null} />);
    expect(mockBlockUnderage).not.toHaveBeenCalled();
    await act(async () => resolveLookup(null));
    expect(screen.getByText(/will be deleted/)).toBeInTheDocument();
    expect(mockBlockUnderage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Pick your handle")).not.toBeInTheDocument();
  });

  it("never retries a removal for an account the lookup finds a profile for", async () => {
    markAgeGateBlocked();
    const onDone = vi.fn();
    mockGetUserProfile.mockResolvedValueOnce({ uid: "u1", username: "adult" });
    render(<ProfileSetup {...defaultProps} dob={null} onDone={onDone} />);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockBlockUnderage).not.toHaveBeenCalled();
  });

  it("ignores the 24h block when the DOB came from email sign-up", async () => {
    markAgeGateBlocked();
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    expect(mockBlockUnderage).not.toHaveBeenCalled();
  });

  it("requires parental consent before submitting for users 13-17", async () => {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2011");
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    expect(screen.getByText(/Parental or guardian consent is required/)).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid inline DOB (Feb 30)", async () => {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "02");
    await userEvent.type(screen.getByLabelText("Birth day"), "30");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    expect(screen.getByText("Please enter a valid date")).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();
  });

  it("submits the inline DOB with createProfile when everything is valid", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "newuser", stance: "Regular" };
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} dob={null} onDone={onDone} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "15");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, "2000-01-15", false, true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("includes the parental-consent flag when a minor confirms consent", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "teenuser", stance: "Regular" };
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} dob={null} onDone={onDone} />);
    await typeAvailableUsername("teenuser");
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2011");

    await userEvent.click(screen.getByLabelText("Parental consent"));
    await acceptTerms();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "teenuser", "Regular", false, "2011-01-01", true, true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });
});
