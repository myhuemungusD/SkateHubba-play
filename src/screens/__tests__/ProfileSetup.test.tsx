import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSetup } from "../ProfileSetup";

const mockCreateProfile = vi.fn();
const mockGetUserProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();
const mockNavigate = vi.fn();

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

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
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
  };

  /** Helper: wait for the existing-profile check to complete and the form to appear */
  async function waitForForm() {
    await waitFor(() => expect(screen.getByText("Pick your handle")).toBeInTheDocument());
  }

  /** Helper: fill username and advance past Step 1 */
  async function fillUsernameAndAdvance(username = "newuser") {
    mockIsUsernameAvailable.mockResolvedValue(true);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, username);
    await waitFor(() => expect(screen.getByText(new RegExp(`@${username} is available`))).toBeInTheDocument());
    await userEvent.click(screen.getByText("Next"));
  }

  // ─── Step 1: Username ──────────────────────────────────────

  it("renders step 1 by default with progress bar", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("submits with short username shows error", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "ab");

    // Submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText(/Username must be \d\+ characters/)).toBeInTheDocument();
  });

  it("submits with too long username shows error (validation path)", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.maxLength).toBe(20);
  });

  it("submits when available is false shows 'Username is taken'", async () => {
    mockIsUsernameAvailable.mockResolvedValue(false);
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "takenuser");

    await waitFor(() => expect(screen.getByText(/@takenuser is taken/)).toBeInTheDocument());

    // Button is disabled when taken, so submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username is taken")).toBeInTheDocument();
  });

  it("submits when available is null (still checking) shows error", async () => {
    mockIsUsernameAvailable.mockImplementation(() => new Promise(() => {}));
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "checking");

    expect(screen.getByText("Checking...")).toBeInTheDocument();

    // Button is disabled while checking, so submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Still checking username — wait a moment")).toBeInTheDocument();
  });

  it("username availability check failure shows error", async () => {
    mockIsUsernameAvailable.mockRejectedValue(new Error("Network"));

    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "testname");

    // The component retries once after 1.5s before surfacing the error
    await waitFor(
      () => {
        expect(screen.getByText("Could not check username — try again")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("uses displayName as initial value", async () => {
    render(<ProfileSetup {...defaultProps} displayName="Sk8 Master" />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.value).toBe("sk8master");
  });

  it("submits with username > 20 chars shows too-long error", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await waitForForm();
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    // Use fireEvent.change to bypass maxLength attribute
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "abcdefghijklmnopqrstuvwxyz" } });

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText(/Username too long \(max \d+\)/)).toBeInTheDocument();
  });

  // ─── Step 2: Stance ────────────────────────────────────────

  it("advances to step 2 when username is valid", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();

    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("What's your stance?")).toBeInTheDocument();
  });

  it("stance toggle works on step 2", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();

    await userEvent.click(screen.getByText("Goofy"));
    expect(screen.getByRole("radio", { name: /Goofy/ })).toHaveAttribute("aria-checked", "true");
  });

  it("back button on step 2 returns to step 1", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();

    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Back"));

    expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument();
  });

  // ─── Step 3: Review & Submit ───────────────────────────────

  it("advances to step 3 with profile preview", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();

    // Step 2 → Step 3
    await userEvent.click(screen.getByText("Next"));

    expect(screen.getByText("STEP 3 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Looking good")).toBeInTheDocument();
    expect(screen.getByText("@newuser")).toBeInTheDocument();
    expect(screen.getByText("Regular")).toBeInTheDocument();
  });

  it("successful submission calls onDone from step 3", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "newuser", stance: "Regular" };
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    // Step 1 → 2
    await fillUsernameAndAdvance();
    // Step 2 → 3
    await userEvent.click(screen.getByText("Next"));
    // Submit
    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Regular", false, undefined, undefined);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("shows error when createProfile fails", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockRejectedValueOnce(new Error("Write failed"));

    render(<ProfileSetup {...defaultProps} />);

    await fillUsernameAndAdvance();
    await userEvent.click(screen.getByText("Next"));
    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Write failed")).toBeInTheDocument();
    });
  });

  it("shows fallback error when createProfile throws non-Error", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockRejectedValueOnce("string error");

    render(<ProfileSetup {...defaultProps} />);

    await fillUsernameAndAdvance();
    await userEvent.click(screen.getByText("Next"));
    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Could not create profile")).toBeInTheDocument();
    });
  });

  it("shows Creating... state during submission", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockImplementation(() => new Promise(() => {}));

    render(<ProfileSetup {...defaultProps} />);

    await fillUsernameAndAdvance();
    await userEvent.click(screen.getByText("Next"));
    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Creating...")).toBeInTheDocument();
    });
  });

  it("selects Goofy stance and submits correctly", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", username: "newuser", stance: "Goofy" };
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    await fillUsernameAndAdvance();

    // Pick Goofy on step 2
    await userEvent.click(screen.getByText("Goofy"));
    await userEvent.click(screen.getByText("Next"));

    // Step 3 shows Goofy
    expect(screen.getByText("Goofy")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "newuser", "Goofy", false, undefined, undefined);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("skips setup and calls onDone when user already has a profile", async () => {
    const onDone = vi.fn();
    const existingProfile = { uid: "u1", username: "existinguser", stance: "Goofy" };
    mockGetUserProfile.mockResolvedValue(existingProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(existingProfile);
    });
    expect(mockGetUserProfile).toHaveBeenCalledWith("u1");
  });

  it("shows setup form when existing profile check fails", async () => {
    mockGetUserProfile.mockRejectedValue(new Error("Network error"));

    render(<ProfileSetup {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Pick your handle")).toBeInTheDocument();
    });
  });

  it("back button on step 3 returns to step 2", async () => {
    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();
    await userEvent.click(screen.getByText("Next"));

    expect(screen.getByText("STEP 3 OF 3")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Back"));

    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
  });

  it("redirects to /age-gate when createProfile rejects with AgeVerificationRequiredError (COPPA)", async () => {
    mockCreateProfile.mockRejectedValue(new MockAgeVerificationRequiredError());

    render(<ProfileSetup {...defaultProps} />);
    await fillUsernameAndAdvance();
    await userEvent.click(screen.getByText("Next"));
    expect(screen.getByText("STEP 3 OF 3")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/age-gate", { replace: true });
    });
    // Error banner should NOT be rendered for this case — we redirect instead.
    expect(screen.queryByText(/Age verification required/)).not.toBeInTheDocument();
  });
});
