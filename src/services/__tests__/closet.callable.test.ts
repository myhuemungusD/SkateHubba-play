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

vi.mock("../../firebase");
vi.mock("firebase/functions", () => ({
  getFunctions: fns.getFunctions,
  httpsCallable: fns.httpsCallable,
  connectFunctionsEmulator: fns.connectFunctionsEmulator,
}));

async function load() {
  vi.resetModules();
  return import("../closet.callable");
}

beforeEach(() => {
  vi.clearAllMocks();
  fns.invoke.mockResolvedValue({ data: { ok: true } });
});

describe("callCloset", () => {
  it("runs App Check, then calls the named callable in us-central1", async () => {
    const { callCloset } = await load();
    const firebase = await import("../../firebase");
    await expect(callCloset("claimDrop", { dropId: "d1" })).resolves.toEqual({ ok: true });
    expect(firebase.ensureAppCheck).toHaveBeenCalled();
    expect(fns.getFunctions).toHaveBeenCalledWith(expect.anything(), "us-central1");
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), "claimDrop");
    expect(fns.invoke).toHaveBeenCalledWith({ dropId: "d1" });
    expect(fns.connectFunctionsEmulator).not.toHaveBeenCalled();
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
    vi.doUnmock("../../firebase");
  });

  it("throws when Firebase never initialized", async () => {
    vi.doMock("../../firebase", async () => ({
      ...(await vi.importActual<typeof import("../../__mocks__/firebase")>("../../__mocks__/firebase")),
      default: null,
    }));
    const { callCloset } = await load();
    await expect(callCloset("equipItem", {})).rejects.toThrow("Firebase not initialized");
    vi.doUnmock("../../firebase");
  });
});
