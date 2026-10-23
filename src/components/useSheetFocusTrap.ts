import { useEffect, type RefObject } from "react";
import { useSwipeDownToClose } from "./useSwipeDownToClose";

/**
 * Manual focus-trap (audit D3) for a bottom sheet: Tab loops within the
 * sheet, Escape calls `onClose`, a pull-down from the top calls `onClose`,
 * and the first control is focused on mount. On unmount, focus goes back to
 * whatever had it when the sheet opened (e.g. the ••• trigger), unless
 * something else has already taken it.
 */
export function useSheetFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useSwipeDownToClose(ref, onClose);
  // Mount-only, and declared before the trap below so it records the opener
  // before focus moves into the sheet. A sheet's DOM is gone by the time this
  // cleanup runs, so focus sitting on <body> means the sheet dropped it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    return () => {
      const dropped = document.activeElement === document.body;
      if (dropped && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    ref.current?.querySelector<HTMLElement>("button,a,input")?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [ref, onClose]);
}
