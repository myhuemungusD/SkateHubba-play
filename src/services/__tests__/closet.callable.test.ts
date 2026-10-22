import { beforeEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => {
  const invoke = vi.fn();
  return {
    invoke,
    getFunctions: vi.fn(() => ({ region: "us-central1" })),
    httpsCallable: vi.fn(() => invoke),
    connectFunctionsEmulator: vi.fn(),
  };
});

const ac = vi.hoisted(() => ({
  ensureClosetAppCheck: vi.fn(() => Promise.resolve()),
  usesLazyWebAppCheck: vi.fn(() => true),
  askDeviceCheckRetry: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("../../firebase");
vi.mock("firebase/functions", () => ({
  getFunctions: fns.getFunctions,
  httpsCallable: fns.httpsCallable,
  connectFunctionsEmulator: fns.connectFunctionsEmulator,
}));
vi.mock("../closetAppCheck", async () => ({
  ...(await vi.importActual<typeof import("../closetAppCheck")>("../closetAppCheck")),
  ensureClosetAppCheck: ac.ensureClosetAppCheck,
  usesLazyWebAppCheck: ac.usesLazyWebAppCheck,
  askDeviceCheckRetry: ac.askDeviceCheckRetry,
}));

async function load() {
  vi.resetModules();
  return import("../closet.callable");
}

const appCheckError = Object.assign(new Error("AppCheck: ReCAPTCHA error."), { code: "appCheck/recaptcha-error" });

beforeEach(() => {
  vi.clearAllMocks();
  fns.invoke.mockResolvedValue({ data: { ok: true } });
  ac.ensureClosetAppCheck.mockResolvedValue(undefined);
  ac.usesLazyWebAppCheck.mockReturnValue(true);
  ac.askDeviceCheckRetry.mockResolvedValue(false);
});

describe("callCloset", () => {
  it("starts closet App Check, then calls the named callable with a limited-use token", async () => {
    const { callCloset } = await load();
    await expect(callCloset("claimDrop", { dropId: "d1" })).resolves.toEqual({ ok: true });
    expect(ac.ensureClosetAppCheck).toHaveBeenCalledTimes(1);
    expect(ac.ensureClosetAppCheck.mock.invocationCallOrder[0]).toBeLessThan(
      fns.httpsCallable.mock.invocationCallOrder[0],
    );
    expect(fns.getFunctions).toHaveBeenCalledWith(expect.anything(), "us-central1");
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), "claimDrop", {
      limitedUseAppCheckTokens: true,
    });
    expect(fns.invoke).toHaveBeenCalledWith({ dropId: "d1" });
    expect(fns.connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it("keeps the default token options outside lazy web mode (sitewide or native)", async () => {
    ac.usesLazyWebAppCheck.mockReturnValue(false);
    const { callCloset } = await load();
    await callCloset("equipItem", { copyId: "c1", equip: true });
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), "equipItem", undefined);
  });

  it("connects the emulator once in emulator mode", async () => {
    vi.doMock("../../firebase", async () => ({
      ...(await vi.importActual<typeof import("../../__mocks__/firebase")>("../../__mocks__/firebase")),
      isEmulatorMode: true,
    }));
    const { callCloset } = await load();
    await callCloset("equipItem", {});
    await callCloset("equipItem", {});
    expect(fns.connectFunctionsEmulator).toHaveBeenCalledTimes(1);
    vi.doMock("../../firebase");
  });

  it("throws when Firebase never initialized", async () => {
    vi.doMock("../../firebase", async () => ({
      ...(await vi.importActual<typeof import("../../__mocks__/firebase")>("../../__mocks__/firebase")),
      default: null,
    }));
    const { callCloset } = await load();
    await expect(callCloset("equipItem", {})).rejects.toThrow("Firebase not initialized");
    expect(ac.askDeviceCheckRetry).not.toHaveBeenCalled();
    vi.doMock("../../firebase");
  });

  it("passes server errors straight through without the retry prompt", async () => {
    const soldOut = Object.assign(new Error("sold_out"), { code: "functions/resource-exhausted" });
    fns.invoke.mockRejectedValueOnce(soldOut);
    const { callCloset } = await load();
    await expect(callCloset("claimDrop", { dropId: "d1" })).rejects.toBe(soldOut);
    expect(ac.askDeviceCheckRetry).not.toHaveBeenCalled();
  });

  it("asks to retry when the token fetch fails, and runs the same call again on Retry", async () => {
    fns.invoke.mockRejectedValueOnce(appCheckError);
    ac.askDeviceCheckRetry.mockResolvedValueOnce(true);
    const { callCloset } = await load();
    await expect(callCloset("buyShopItem", { itemDefId: "i1" })).resolves.toEqual({ ok: true });
    expect(ac.askDeviceCheckRetry).toHaveBeenCalledTimes(1);
    expect(ac.ensureClosetAppCheck).toHaveBeenCalledTimes(2);
    expect(fns.invoke).toHaveBeenCalledTimes(2);
    expect(fns.invoke).toHaveBeenLastCalledWith({ itemDefId: "i1" });
  });

  it("asks to retry when reCAPTCHA never loads, and rejects with a plain DeviceCheckError when passed on", async () => {
    const { DeviceCheckError } = await import("../closetAppCheck");
    const loadFailure = new DeviceCheckError();
    ac.ensureClosetAppCheck.mockRejectedValueOnce(loadFailure);
    const { callCloset } = await load();
    await expect(callCloset("claimDrop", { dropId: "d1" })).rejects.toBe(loadFailure);
    expect(ac.askDeviceCheckRetry).toHaveBeenCalledTimes(1);
    expect(fns.invoke).not.toHaveBeenCalled();
  });

  it("turns an App Check SDK or server rejection into DeviceCheckError when passed on", async () => {
    fns.invoke.mockRejectedValueOnce(appCheckError);
    fns.invoke.mockRejectedValueOnce({ code: "functions/unauthenticated", message: "Unauthenticated" });
    ac.askDeviceCheckRetry.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { callCloset } = await load();
    const err = await callCloset("enterDraw", { dropId: "d1" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "device_check_failed", message: "Couldn't verify this device. Try again." });
    expect(ac.askDeviceCheckRetry).toHaveBeenCalledTimes(2);
  });
});
