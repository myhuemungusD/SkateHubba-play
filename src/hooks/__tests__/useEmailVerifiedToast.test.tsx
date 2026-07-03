import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { NotificationProvider, useNotifications } from "../../context/NotificationContext";
import { useEmailVerifiedToast } from "../useEmailVerifiedToast";

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid="u1">{children}</NotificationProvider>;
}

/** Compose the hook under test with a live handle on the current
 *  notifications so tests can assert on toast side-effects without
 *  reaching into the provider internals. */
function useHarness(initial: boolean | null | undefined) {
  useEmailVerifiedToast(initial);
  return useNotifications();
}

describe("useEmailVerifiedToast", () => {
  it("does NOT fire a toast on initial mount for an already-verified user", () => {
    const { result } = renderHook((props: { verified: boolean }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: true },
    });
    expect(result.current.toasts).toHaveLength(0);
    expect(result.current.notifications).toHaveLength(0);
  });

  it("does NOT fire a toast on initial mount for an unverified user", () => {
    const { result } = renderHook((props: { verified: boolean }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: false },
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("fires a success toast when emailVerified transitions false → true", () => {
    const { result, rerender } = renderHook((props: { verified: boolean }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: false },
    });
    expect(result.current.toasts).toHaveLength(0);

    act(() => {
      rerender({ verified: true });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      type: "success",
      title: "Email verified",
      message: "You can challenge players now.",
    });
  });

  it("does NOT fire on true → false (should never happen but is a safety guard)", () => {
    const { result, rerender } = renderHook((props: { verified: boolean }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: true },
    });

    act(() => {
      rerender({ verified: false });
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("does NOT re-fire on repeated true → true renders", () => {
    const { result, rerender } = renderHook((props: { verified: boolean }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: false },
    });

    act(() => {
      rerender({ verified: true });
    });
    expect(result.current.toasts).toHaveLength(1);

    // Additional renders while already verified must not queue duplicates.
    act(() => {
      rerender({ verified: true });
    });
    act(() => {
      rerender({ verified: true });
    });
    expect(result.current.toasts).toHaveLength(1);
  });

  it("treats undefined/null baseline (signed out) as no-op", () => {
    const { result, rerender } = renderHook((props: { verified: boolean | undefined }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: undefined as boolean | undefined },
    });
    expect(result.current.toasts).toHaveLength(0);

    // Sign-in as an already-verified user → no toast.
    act(() => {
      rerender({ verified: true });
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("fires the toast when going null → false → true (sign-in, then verify)", () => {
    const { result, rerender } = renderHook((props: { verified: boolean | undefined }) => useHarness(props.verified), {
      wrapper: Wrapper,
      initialProps: { verified: undefined as boolean | undefined },
    });

    act(() => {
      rerender({ verified: false });
    });
    expect(result.current.toasts).toHaveLength(0);

    act(() => {
      rerender({ verified: true });
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});
