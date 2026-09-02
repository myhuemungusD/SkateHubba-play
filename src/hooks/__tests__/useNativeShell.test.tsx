import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";

/* ── mocks ───────────────────────────────────── */

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const { mockInitStatusBar, mockExitNativeApp, mockSubscribeBack, mockSubscribeDeepLinks } = vi.hoisted(() => ({
  mockInitStatusBar: vi.fn(),
  mockExitNativeApp: vi.fn(),
  mockSubscribeBack: vi.fn(),
  mockSubscribeDeepLinks: vi.fn(),
}));
vi.mock("../../services/nativeShell", () => ({
  initStatusBar: () => mockInitStatusBar(),
  exitNativeApp: () => mockExitNativeApp(),
  subscribeToBackButton: (cb: unknown) => mockSubscribeBack(cb),
  subscribeToDeepLinks: (cb: unknown) => mockSubscribeDeepLinks(cb),
}));

import { useNativeShell } from "../useNativeShell";
import { OPEN_GAME_EVENT } from "../../components/GameNotificationWatcher";

type BackCb = (e: { canGoBack: boolean }) => void;
type LinkCb = (path: string) => void;

let backCb: BackCb = () => {};
let linkCb: LinkCb = () => {};
const unsubBack = vi.fn();
const unsubLinks = vi.fn();

function mount(initialPath = "/lobby") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );
  return renderHook(() => useNativeShell(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInitStatusBar.mockResolvedValue(undefined);
  mockExitNativeApp.mockResolvedValue(undefined);
  mockSubscribeBack.mockImplementation((cb: BackCb) => {
    backCb = cb;
    return unsubBack;
  });
  mockSubscribeDeepLinks.mockImplementation((cb: LinkCb) => {
    linkCb = cb;
    return unsubLinks;
  });
});

describe("useNativeShell", () => {
  it("styles the status bar once on mount", () => {
    mount();
    expect(mockInitStatusBar).toHaveBeenCalledOnce();
  });

  it("pops SPA history when back is pressed away from a root screen", () => {
    mount("/settings");
    backCb({ canGoBack: true });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
    expect(mockExitNativeApp).not.toHaveBeenCalled();
  });

  it.each(["/", "/lobby"])("exits the app when back is pressed at %s", (path) => {
    mount(path);
    backCb({ canGoBack: true });
    expect(mockExitNativeApp).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("exits the app when there is no history to pop", () => {
    mount("/settings");
    backCb({ canGoBack: false });
    expect(mockExitNativeApp).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("routes a /game/<id> deep link through the OPEN_GAME_EVENT bridge", () => {
    mount();
    const onOpen = vi.fn();
    window.addEventListener(OPEN_GAME_EVENT, onOpen);
    linkCb("/game/abc%20123");
    window.removeEventListener(OPEN_GAME_EVENT, onOpen);

    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toEqual({ gameId: "abc 123" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates directly for every other deep-link path", () => {
    mount();
    linkCb("/spots/xyz?from=push");
    expect(mockNavigate).toHaveBeenCalledWith("/spots/xyz?from=push");
  });

  it("unsubscribes both listeners on unmount", () => {
    const { unmount } = mount();
    unmount();
    expect(unsubBack).toHaveBeenCalledOnce();
    expect(unsubLinks).toHaveBeenCalledOnce();
  });
});
