import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import {
  AvatarBorderlineError,
  AvatarRejectedError,
  AvatarTooLargeError,
  AvatarTooSmallError,
} from "../../services/avatars";

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
  it("portals to <body> so an animated profile card cannot become its containing block", () => {
    const { container } = render(
      <div className="animate-fade-in">
        <AvatarPicker uid="user-1" onUploaded={vi.fn()} onClose={vi.fn()} />
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Choose profile picture" });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });

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

describe("AvatarPicker — transport failure clears the dangling pointer", () => {
  it("best-effort clears profileImageUrl when uploadAvatar throws a transport error", async () => {
    // uploadAvatar deletes the old object before uploading. A transport failure
    // here leaves profileImageUrl pointing at a deleted object, so the handler
    // must clear it (setProfileImageUrl(uid, null)) → fall back to default.
    mockUploadAvatar.mockRejectedValueOnce(new Error("network down"));
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));

    await waitFor(() =>
      expect(screen.getByText("Upload failed. Check your connection and try again.")).toBeInTheDocument(),
    );
    await waitFor(() => expect(mockSetProfileImageUrl).toHaveBeenCalledWith("user-1", null));
  });

  it("swallows a failure to clear the pointer (best-effort, stays on error UI)", async () => {
    mockUploadAvatar.mockRejectedValueOnce(new Error("network down"));
    mockSetProfileImageUrl.mockRejectedValueOnce(new Error("clear failed"));
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));

    await waitFor(() =>
      expect(screen.getByText("Upload failed. Check your connection and try again.")).toBeInTheDocument(),
    );
    expect(mockSetProfileImageUrl).toHaveBeenCalledWith("user-1", null);
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

  it("treats backing out of the native picker as a silent no-op, not a denial", async () => {
    const { Capacitor } = await import("@capacitor/core");
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const getPhoto = vi.fn().mockRejectedValue(new Error("User cancelled photos app"));
    vi.doMock("@capacitor/camera", () => ({
      Camera: { getPhoto },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Choose From Gallery"));
      await waitFor(() => expect(getPhoto).toHaveBeenCalled());
      expect(screen.queryByText(/access denied/)).not.toBeInTheDocument();
      expect(screen.getByText("Choose From Gallery")).toBeInTheDocument();
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

describe("AvatarPicker — size rejections", () => {
  it.each([
    [new AvatarTooLargeError(9_000_000), "Image too large after compression. Try a different photo."],
    [new AvatarTooSmallError(10), "Image too small. Try a different photo."],
  ])("maps %s to its message", async (err, message) => {
    mockUploadAvatar.mockRejectedValueOnce(err);
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
  });
});

describe("AvatarPicker — paste URL screen", () => {
  async function submitUrl(response: Response | Error): Promise<void> {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    if (response instanceof Error) fetchSpy.mockRejectedValue(response);
    else fetchSpy.mockResolvedValue(response);
    renderPicker();
    await userEvent.click(screen.getByText("Paste Image URL"));
    await userEvent.type(screen.getByPlaceholderText("https://…/avatar.png"), "https://example.com/a.png");
    await userEvent.click(screen.getByText("Continue"));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the image and opens the preview", async () => {
    const blob = new Blob([new Uint8Array(16)], { type: "image/png" });
    await submitUrl({ ok: true, blob: async () => blob } as unknown as Response);
    await waitFor(() => expect(screen.getByAltText("Avatar preview")).toBeInTheDocument());
  });

  it.each([new Response(null, { status: 404 }), new Error("offline")])(
    "shows the fetch error for %s",
    async (response) => {
      await submitUrl(response);
      await waitFor(() =>
        expect(screen.getByText("Couldn't fetch that URL. Try a different image.")).toBeInTheDocument(),
      );
    },
  );

  it("returns to the menu from the URL screen", async () => {
    renderPicker();
    await userEvent.click(screen.getByText("Paste Image URL"));
    await userEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Take Photo")).toBeInTheDocument();
  });
});

describe("AvatarPicker — native capture success", () => {
  it.each([
    ["png", "Take Photo"],
    ["webp", "Choose From Gallery"],
    ["jpeg", "Take Photo"],
  ])("opens the preview for a %s photo from %s", async (format, button) => {
    const { Capacitor } = await import("@capacitor/core");
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.doMock("@capacitor/camera", () => ({
      Camera: { getPhoto: vi.fn().mockResolvedValue({ base64String: btoa("img"), format }) },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText(button));
      await waitFor(() => expect(screen.getByAltText("Avatar preview")).toBeInTheDocument());
    } finally {
      spy.mockRestore();
      vi.doUnmock("@capacitor/camera");
    }
  });

  it("stays on the menu when the plugin returns no image", async () => {
    const { Capacitor } = await import("@capacitor/core");
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.doMock("@capacitor/camera", () => ({
      Camera: { getPhoto: vi.fn().mockResolvedValue({}) },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Take Photo"));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByAltText("Avatar preview")).toBeNull();
      expect(screen.getByText("Take Photo")).toBeInTheDocument();
    } finally {
      spy.mockRestore();
      vi.doUnmock("@capacitor/camera");
    }
  });
});

describe("isPickerCancel", () => {
  it("matches the Capacitor cancel rejection in either shape", async () => {
    const { isPickerCancel } = await import("../avatarPickerShared");
    expect(isPickerCancel(new Error("User cancelled photos app"))).toBe(true);
    expect(isPickerCancel("User cancelled photos app")).toBe(true);
    expect(isPickerCancel(new Error("Photos permission denied"))).toBe(false);
  });
});

describe("AvatarPicker — web inputs, preview Back, and non-Error rejections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the matching hidden input on the web, and ignores a change with no file", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderPicker();
    const [cameraInput, galleryInput] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    fireEvent.click(screen.getByText("Take Photo"));
    fireEvent.click(screen.getByText("Choose From Gallery"));
    expect(click.mock.contexts).toEqual([cameraInput, galleryInput]);
    fireEvent.change(galleryInput, { target: { files: [] } });
    expect(screen.getByText("Take Photo")).toBeInTheDocument();
  });

  it("goes back from the preview to the source menu", async () => {
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Choose From Gallery")).toBeInTheDocument();
  });

  it("still shows the transport message when the upload and the pointer clear reject with bare strings", async () => {
    mockUploadAvatar.mockRejectedValueOnce("socket hang up");
    mockSetProfileImageUrl.mockRejectedValueOnce("still offline");
    renderPicker();
    await pickFileAndOpenPreview();
    await userEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(mockSetProfileImageUrl).toHaveBeenCalledWith("user-1", null));
    expect(await screen.findByText("Upload failed. Check your connection and try again.")).toBeInTheDocument();
  });

  it("shows the URL fetch message for a bare-string rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("dns");
    renderPicker();
    await userEvent.click(screen.getByText("Paste Image URL"));
    await userEvent.type(screen.getByPlaceholderText("https://…/avatar.png"), "https://example.com/b.png");
    await userEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("Couldn't fetch that URL. Try a different image.")).toBeInTheDocument();
  });

  it("treats a bare-string native denial as a denial", async () => {
    const { Capacitor } = await import("@capacitor/core");
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.doMock("@capacitor/camera", () => ({
      Camera: { getPhoto: vi.fn().mockRejectedValue("denied") },
      CameraResultType: { Base64: "base64" },
      CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    }));
    try {
      renderPicker();
      await userEvent.click(screen.getByText("Take Photo"));
      expect(await screen.findByText("Camera access denied. Check your device settings.")).toBeInTheDocument();
    } finally {
      vi.doUnmock("@capacitor/camera");
    }
  });
});
