import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSetup } from "../ProfileSetup";

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
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  AgeVerificationRequiredError: MockAgeVerificationRequiredError,
  // ProfileSetup imports these shared validation constants — mirror the
  // real values so the mocked module still exports them.
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  USERNAME_RE: /^[a-z0-9_]+$/,
}));

beforeEach(() => {
  vi.clearAllMocks();
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
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, "2000-01-15", false);
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
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Goofy", false, "2000-01-15", false);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("surfaces service-level errors when createProfile fails", async () => {
    mockCreateProfile.mockRejectedValueOnce(new Error("Write failed"));

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Write failed")).toBeInTheDocument());
  });

  it("falls back to a generic message when createProfile rejects with a non-Error", async () => {
    mockCreateProfile.mockRejectedValueOnce("string error");

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => expect(screen.getByText("Could not create profile")).toBeInTheDocument());
  });

  it("shows the creating spinner while the submit is in flight", async () => {
    mockCreateProfile.mockImplementation(() => new Promise(() => {}));

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
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

  it("shows the form when the existing-profile check rejects", async () => {
    mockGetUserProfile.mockRejectedValue(new Error("Network error"));

    render(<ProfileSetup {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Pick your handle")).toBeInTheDocument());
  });

  it("surfaces an inline message when the service rejects for missing DOB", async () => {
    mockCreateProfile.mockRejectedValue(new MockAgeVerificationRequiredError());

    render(<ProfileSetup {...defaultProps} />);
    await typeAvailableUsername();
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

  it("blocks users under 13 from creating a profile when collecting DOB inline", async () => {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2020");
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    expect(screen.getByText(/at least 13 years old/)).toBeInTheDocument();
    expect(mockCreateProfile).not.toHaveBeenCalled();
  });

  it("requires parental consent before submitting for users 13-17", async () => {
    render(<ProfileSetup {...defaultProps} dob={null} />);
    await typeAvailableUsername();
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2011");
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
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, "2000-01-15", false);
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
    await userEvent.click(screen.getByRole("button", { name: /Lock It In/ }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "teenuser", "Regular", false, "2011-01-01", true);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });
});
