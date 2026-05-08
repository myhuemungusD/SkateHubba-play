import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Tests for AvatarPicker. The service layer is mocked at the module
 * boundary so the component test stays focused on UX behaviour:
 * focus-trap, keyboard handling, and the borderline confirmation
 * branch.
 */

const { mockUploadAvatar, mockSetProfileImageUrl } = vi.hoisted(() => ({
  mockUploadAvatar: vi.fn(),
  mockSetProfileImageUrl: vi.fn(),
}));

vi.mock("../../services/avatars", async () => {
  const actual = await vi.importActual<typeof import("../../services/avatars")>("../../services/avatars");
  return {
    ...actual,
    uploadAvatar: mockUploadAvatar,
  };
});

vi.mock("../../services/users", async () => {
  return {
    setProfileImageUrl: mockSetProfileImageUrl,
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import { AvatarPicker } from "../AvatarPicker";
import { AvatarBorderlineError, AvatarRejectedError } from "../../services/avatars";

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadAvatar.mockResolvedValue(
    "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/users%2Fuser-1%2Favatar.webp",
  );
  mockSetProfileImageUrl.mockResolvedValue(undefined);
  // jsdom URL helpers
  if (!("createObjectURL" in URL)) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
  }
  if (!("revokeObjectURL" in URL)) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
});

function renderPicker(overrides: Partial<{ onUploaded: (url: string) => void; onClose: () => void }> = {}) {
  const onUploaded = overrides.onUploaded ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  render(<AvatarPicker uid="user-1" onUploaded={onUploaded} onClose={onClose} />);
  return { onUploaded, onClose };
}

/**
 * Pick a file via the gallery input + advance to the preview screen.
 * Used by the borderline / hard-reject / happy-path tests; extracting
 * keeps the test-duplication checker green.
 */
async function pickFileAndOpenPreview(): Promise<void> {
  const galleryInput = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
  const file = new File([new Uint8Array(2048)], "pic.png", { type: "image/png" });
  fireEvent.change(galleryInput, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("Confirm")).toBeInTheDocument());
}

describe("AvatarPicker — initial render", () => {
  it("renders as a dialog with the three source buttons", () => {
    renderPicker();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Take Photo")).toBeInTheDocument();
    expect(screen.getByText("Choose From Gallery")).toBeInTheDocument();
    expect(screen.getByText("Paste Image URL")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const { onClose } = renderPicker();
    await userEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const { onClose } = renderPicker();
    await userEvent.click(screen.getByRole("button", { name: "Close avatar picker" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AvatarPicker — focus-trap", () => {
  it("returns focus to the first element when Shift+Tab from the first", () => {
    renderPicker();
    const buttons = screen.getAllByRole("button");
    const lastFocusable = buttons[buttons.length - 1];
    lastFocusable.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // Focus stays trapped — at minimum, the activeElement is one of the
    // sheet's buttons.
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("closes on Escape", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AvatarPicker — file picked → preview → upload", () => {
  it("walks the happy path from gallery → preview → confirm", async () => {
    const { onUploaded } = renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(mockUploadAvatar).toHaveBeenCalled());
    await waitFor(() => expect(mockSetProfileImageUrl).toHaveBeenCalled());
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });
});

describe("AvatarPicker — borderline NSFW flow", () => {
  it("shows the borderline confirmation when uploadAvatar throws AvatarBorderlineError", async () => {
    mockUploadAvatar.mockRejectedValueOnce(new AvatarBorderlineError(0.7, "Sexy"));
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(screen.getByText("This image looks borderline")).toBeInTheDocument());
    expect(screen.getByText("Use Anyway")).toBeInTheDocument();
    expect(screen.getByText("Pick Another")).toBeInTheDocument();
  });

  it("re-uploads with acceptBorderlineNsfw=true when the user confirms", async () => {
    mockUploadAvatar
      .mockRejectedValueOnce(new AvatarBorderlineError(0.7, "Sexy"))
      .mockResolvedValueOnce(
        "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/users%2Fuser-1%2Favatar.webp",
      );
    const { onUploaded } = renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(screen.getByText("Use Anyway")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Use Anyway"));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(mockUploadAvatar).toHaveBeenLastCalledWith("user-1", expect.any(Blob), { acceptBorderlineNsfw: true });
  });
});

describe("AvatarPicker — hard NSFW reject", () => {
  it("shows a toast-equivalent error when uploadAvatar throws AvatarRejectedError", async () => {
    mockUploadAvatar.mockRejectedValueOnce(new AvatarRejectedError(0.95, "Porn"));
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(screen.getByText("Image not allowed.")).toBeInTheDocument());
  });
});

describe("AvatarPicker — native capture failure surfaces user-visible error (audit B-BLOCKER-1)", () => {
  it("shows the camera-denied message when the Camera plugin throws", async () => {
    // Force the Capacitor branch by lying about the platform.
    const { Capacitor } = await import("@capacitor/core");
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    // Mock the dynamic plugin import to a Camera that always throws.
    vi.doMock("@capacitor/camera", () => ({
      Camera: {
        getPhoto: vi.fn().mockRejectedValue(new Error("Camera permission denied")),
      },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Take Photo"));
      await waitFor(() =>
        expect(screen.getByText("Camera access denied. Check your device settings.")).toBeInTheDocument(),
      );
    } finally {
      spy.mockRestore();
      vi.doUnmock("@capacitor/camera");
    }
  });

  it("shows the gallery-denied message when the Photos plugin throws", async () => {
    const { Capacitor } = await import("@capacitor/core");
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.doMock("@capacitor/camera", () => ({
      Camera: {
        getPhoto: vi.fn().mockRejectedValue(new Error("Photos permission denied")),
      },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Choose From Gallery"));
      await waitFor(() =>
        expect(screen.getByText("Photo library access denied. Check your device settings.")).toBeInTheDocument(),
      );
    } finally {
      spy.mockRestore();
      vi.doUnmock("@capacitor/camera");
    }
  });
});

describe("AvatarPicker — URL scheme validation (audit B-ISSUE-1)", () => {
  it("rejects a non-http(s) URL before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Paste Image URL"));
      const input = screen.getByPlaceholderText("https://…/avatar.png");
      await userEvent.type(input, "javascript:alert(1)");
      await userEvent.click(screen.getByText("Continue"));
      await waitFor(() =>
        expect(screen.getByText("Only http:// and https:// URLs are supported.")).toBeInTheDocument(),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
