import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockGrantVerifiedPro = vi.fn();
const mockRevokeVerifiedPro = vi.fn();
const mockGetUidByUsername = vi.fn();
const mockGetUserProfile = vi.fn();

vi.mock("../../../../services/admin", () => ({
  grantVerifiedPro: (...args: unknown[]) => mockGrantVerifiedPro(...args),
  revokeVerifiedPro: (...args: unknown[]) => mockRevokeVerifiedPro(...args),
}));

vi.mock("../../../../services/users", () => ({
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
}));

vi.mock("../../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { VerifyProPanel } from "../VerifyProPanel";
import { ADMIN_UID, renderWithToasts } from "./adminPanels.test-helpers";

function renderPanel() {
  return renderWithToasts(<VerifyProPanel adminUid={ADMIN_UID} />);
}

/** Type a username into the lookup and submit it. */
async function lookUp(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.type(screen.getByLabelText("PLAYER USERNAME"), username);
  await user.click(screen.getByRole("button", { name: "Look up player" }));
}

const proProfile = { uid: "u1", username: "nyjah", stance: "regular", createdAt: null, isVerifiedPro: true };
const plainProfile = { ...proProfile, isVerifiedPro: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUidByUsername.mockResolvedValue("u1");
  mockGetUserProfile.mockResolvedValue(plainProfile);
  mockGrantVerifiedPro.mockResolvedValue(undefined);
  mockRevokeVerifiedPro.mockResolvedValue(undefined);
});

describe("VerifyProPanel", () => {
  it("looks a player up by normalized username and shows their current status", async () => {
    const user = userEvent.setup();
    renderPanel();

    await lookUp(user, "  Nyjah  ");

    await waitFor(() => expect(screen.getByText("@nyjah")).toBeInTheDocument());
    expect(mockGetUidByUsername).toHaveBeenCalledWith("nyjah");
    expect(mockGetUserProfile).toHaveBeenCalledWith("u1");
    expect(screen.getByTestId("verify-pro-status")).toHaveTextContent("Not verified");
  });

  it("surfaces a miss without rendering an actionable card", async () => {
    const user = userEvent.setup();
    mockGetUidByUsername.mockResolvedValue(null);
    renderPanel();

    await lookUp(user, "ghost");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No player found for @ghost"));
    expect(screen.queryByTestId("verify-pro-status")).not.toBeInTheDocument();
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it("refuses to search on an empty query", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Look up player" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a username.");
    expect(mockGetUidByUsername).not.toHaveBeenCalled();
  });

  it("reports a reserved username whose profile document is gone", async () => {
    const user = userEvent.setup();
    mockGetUserProfile.mockResolvedValue(null);
    renderPanel();

    await lookUp(user, "nyjah");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("@nyjah has no profile document"));
    expect(screen.queryByTestId("verify-pro-status")).not.toBeInTheDocument();
  });

  it("requires a confirm step before granting", async () => {
    const user = userEvent.setup();
    renderPanel();
    await lookUp(user, "nyjah");
    await screen.findByTestId("verify-pro-status");

    await user.click(screen.getByRole("button", { name: "GRANT" }));

    expect(mockGrantVerifiedPro).not.toHaveBeenCalled();
    expect(screen.getByText("Grant Verified Pro to @nyjah?")).toBeInTheDocument();
  });

  it("abandons the grant when the confirm step is cancelled", async () => {
    const user = userEvent.setup();
    renderPanel();
    await lookUp(user, "nyjah");
    await screen.findByTestId("verify-pro-status");

    await user.click(screen.getByRole("button", { name: "GRANT" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockGrantVerifiedPro).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "GRANT" })).toBeInTheDocument();
  });

  it("grants with the admin uid, toasts, and refetches the profile", async () => {
    const user = userEvent.setup();
    renderPanel();
    await lookUp(user, "nyjah");
    await screen.findByTestId("verify-pro-status");
    mockGetUserProfile.mockResolvedValue(proProfile);

    await user.click(screen.getByRole("button", { name: "GRANT" }));
    await user.click(screen.getByRole("button", { name: "GRANT" }));

    await waitFor(() => expect(mockGrantVerifiedPro).toHaveBeenCalledWith(ADMIN_UID, "u1"));
    expect(await screen.findByText("Verified Pro granted")).toBeInTheDocument();
    // Refetched rather than patched locally — the status flips because
    // Firestore now says so.
    await waitFor(() => expect(screen.getByTestId("verify-pro-status")).toHaveTextContent("Verified Pro"));
    expect(mockGetUserProfile).toHaveBeenCalledTimes(2);
  });

  it("revokes an existing Verified Pro", async () => {
    const user = userEvent.setup();
    mockGetUserProfile.mockResolvedValue(proProfile);
    renderPanel();
    await lookUp(user, "nyjah");
    await screen.findByTestId("verify-pro-status");

    await user.click(screen.getByRole("button", { name: "REVOKE" }));
    expect(screen.getByText("Revoke Verified Pro from @nyjah?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "REVOKE" }));

    await waitFor(() => expect(mockRevokeVerifiedPro).toHaveBeenCalledWith(ADMIN_UID, "u1"));
    expect(await screen.findByText("Verified Pro revoked")).toBeInTheDocument();
    expect(mockGrantVerifiedPro).not.toHaveBeenCalled();
  });

  it("toasts the service's reason when the grant fails", async () => {
    const user = userEvent.setup();
    mockGrantVerifiedPro.mockRejectedValue(new Error("Missing or insufficient permissions."));
    renderPanel();
    await lookUp(user, "nyjah");
    await screen.findByTestId("verify-pro-status");

    await user.click(screen.getByRole("button", { name: "GRANT" }));
    await user.click(screen.getByRole("button", { name: "GRANT" }));

    expect(await screen.findByText("Grant failed")).toBeInTheDocument();
    expect(screen.getByText("Missing or insufficient permissions.")).toBeInTheDocument();
    // Failure leaves the status untouched — no optimistic flip to undo.
    expect(screen.getByTestId("verify-pro-status")).toHaveTextContent("Not verified");
  });

  it("toasts a fallback message when the lookup transport fails", async () => {
    const user = userEvent.setup();
    mockGetUidByUsername.mockRejectedValue(new Error("offline"));
    renderPanel();

    await lookUp(user, "nyjah");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Lookup failed. Check your connection and try again."),
    );
  });
});
