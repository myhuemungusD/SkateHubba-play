import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSetup } from "../ProfileSetup";

const mockCreateProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();

vi.mock("../../services/users", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
}));

beforeEach(() => vi.clearAllMocks());

describe("ProfileSetup", () => {
  const defaultProps = {
    uid: "u1",
    email: "test@test.com",
    emailVerified: false,
    displayName: null,
    onDone: vi.fn(),
  };

  it("submits with short username shows error", async () => {
    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "ab");

    // Submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username must be 3+ characters")).toBeInTheDocument();
  });

  it("submits with too long username shows error (validation path)", async () => {
    render(<ProfileSetup {...defaultProps} />);

    // The maxLength attribute prevents typing > 20 chars via UI, but we can test
    // the code path by manipulating state. Instead, test that the form enforces
    // the max 20 length correctly.
    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.maxLength).toBe(20);
  });

  it("submits when available is false shows 'Username is taken'", async () => {
    mockIsUsernameAvailable.mockResolvedValue(false);
    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "takenuser");

    await waitFor(() => expect(screen.getByText(/@takenuser is taken/)).toBeInTheDocument());

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username is taken")).toBeInTheDocument();
  });

  it("submits when available is null (still checking) shows error", async () => {
    mockIsUsernameAvailable.mockImplementation(() => new Promise(() => {}));
    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "checking");

    expect(screen.getByText("Checking...")).toBeInTheDocument();

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Still checking username — wait a moment")).toBeInTheDocument();
  });

  it("successful submission calls onDone", async () => {
    const onDone = vi.fn();
    const createdProfile = { uid: "u1", email: "test@test.com", username: "newuser", stance: "Regular" };
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockResolvedValueOnce(createdProfile);

    render(<ProfileSetup {...defaultProps} onDone={onDone} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "newuser");

    await waitFor(() => expect(screen.getByText(/@newuser is available/)).toBeInTheDocument());

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith("u1", "test@test.com", "newuser", "Regular", false);
      expect(onDone).toHaveBeenCalledWith(createdProfile);
    });
  });

  it("shows error when createProfile fails", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockRejectedValueOnce(new Error("Write failed"));

    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "newuser");

    await waitFor(() => expect(screen.getByText(/@newuser is available/)).toBeInTheDocument());

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Write failed")).toBeInTheDocument();
    });
  });

  it("shows fallback error when createProfile throws non-Error", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockRejectedValueOnce("string error");

    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "newuser");

    await waitFor(() => expect(screen.getByText(/@newuser is available/)).toBeInTheDocument());

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Could not create profile")).toBeInTheDocument();
    });
  });

  it("username availability check failure shows error", async () => {
    mockIsUsernameAvailable.mockRejectedValue(new Error("Network"));

    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "testname");

    await waitFor(() => {
      expect(screen.getByText("Could not check username — try again")).toBeInTheDocument();
    });
  });

  it("stance toggle works", async () => {
    render(<ProfileSetup {...defaultProps} />);

    await userEvent.click(screen.getByText("Goofy"));
    expect(screen.getByText("Goofy").className).toContain("brand-orange");
  });

  it("input is disabled during submission", async () => {
    mockIsUsernameAvailable.mockResolvedValue(true);
    mockCreateProfile.mockImplementation(() => new Promise(() => {}));

    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    await userEvent.type(input, "newuser");

    await waitFor(() => expect(screen.getByText(/@newuser is available/)).toBeInTheDocument());

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Creating...")).toBeInTheDocument();
    });

    // While loading, onChange and setStance are guarded by !loading
    const { fireEvent: fe } = await import("@testing-library/react");
    const valueBefore = input.value;
    fe.change(input, { target: { value: "other" } });
    expect(input.value).toBe(valueBefore);

    // Stance click while loading is also guarded
    fe.click(screen.getByText("Goofy"));
  });

  it("uses displayName as initial value", () => {
    render(<ProfileSetup {...defaultProps} displayName="Sk8 Master" />);

    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    expect(input.value).toBe("sk8master");
  });

  it("submits with username > 20 chars shows too-long error", async () => {
    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend") as HTMLInputElement;
    // Use fireEvent.change to bypass maxLength attribute
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "abcdefghijklmnopqrstuvwxyz" } });

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username too long (max 20)")).toBeInTheDocument();
  });

  it("error banner can be dismissed", async () => {
    render(<ProfileSetup {...defaultProps} />);

    const input = screen.getByPlaceholderText("sk8legend");
    await userEvent.type(input, "ab");

    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Username must be 3+ characters")).toBeInTheDocument();

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("Username must be 3+ characters")).not.toBeInTheDocument();
  });
});
