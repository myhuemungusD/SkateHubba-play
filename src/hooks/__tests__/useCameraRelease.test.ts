import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCameraRelease } from "../useCameraRelease";
import type { CaptureState } from "../useMediaRecorder";

const { mockGranted } = vi.hoisted(() => ({ mockGranted: vi.fn(() => Promise.resolve(true)) }));
vi.mock("../../components/mediaPermissions", () => ({ hasGrantedCameraAndMic: () => mockGranted() }));

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function mount(state: CaptureState, isNative: boolean) {
  const props = {
    state,
    isNative,
    releaseCamera: vi.fn(),
    openNativeCamera: vi.fn(() => Promise.resolve()),
    openCamera: vi.fn(() => Promise.resolve()),
    cancelTimer: vi.fn(),
  };
  const view = renderHook((p: typeof props) => useCameraRelease(p), { initialProps: props });
  return { props, ...view };
}

beforeEach(() => mockGranted.mockResolvedValue(true));
afterEach(() => Reflect.deleteProperty(document, "visibilityState"));

describe("useCameraRelease", () => {
  it("releases the native preview in the background and reopens it on return", () => {
    const { props } = mount("preview", true);
    setVisibility("hidden");
    expect(props.cancelTimer).toHaveBeenCalled();
    expect(props.releaseCamera).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(props.openNativeCamera).toHaveBeenCalledTimes(1);
    // A second "visible" without a release in between does nothing.
    setVisibility("visible");
    expect(props.openNativeCamera).toHaveBeenCalledTimes(1);
  });

  it("does not reopen after a take was stopped by backgrounding", () => {
    const { props } = mount("recording", true);
    setVisibility("hidden");
    expect(props.releaseCamera).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(props.openNativeCamera).not.toHaveBeenCalled();
    expect(props.openCamera).not.toHaveBeenCalled();
  });

  it("tracks the latest state between renders", () => {
    const { props, rerender } = mount("recording", true);
    rerender({ ...props, state: "idle" });
    setVisibility("hidden");
    setVisibility("visible");
    expect(props.openNativeCamera).toHaveBeenCalledTimes(1);
  });

  it("reopens the web stream only when permission is already granted", async () => {
    const { props } = mount("preview", false);
    setVisibility("hidden");
    setVisibility("visible");
    await vi.waitFor(() => expect(props.openCamera).toHaveBeenCalledTimes(1));

    mockGranted.mockResolvedValue(false);
    setVisibility("hidden");
    setVisibility("visible");
    await Promise.resolve();
    await Promise.resolve();
    expect(props.openCamera).toHaveBeenCalledTimes(1);
    expect(props.openNativeCamera).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const { props, unmount } = mount("preview", true);
    unmount();
    setVisibility("hidden");
    expect(props.releaseCamera).not.toHaveBeenCalled();
  });
});
