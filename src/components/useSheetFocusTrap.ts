import { useEffect, type RefObject } from "react";

/**
 * Manual focus-trap (audit D3) for a bottom sheet: Tab loops within the
 * sheet, Escape calls `onClose`, and the first control is focused on mount.
 */
export function useSheetFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
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
