import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Trap Tab/Shift-Tab focus within the referenced container, pulling focus in
 * on mount and restoring it to the previously-focused element on unmount.
 *
 * Initial focus lands on whichever node declares `autoFocus`; if none exists,
 * the first focusable element inside the container is focused so keyboard
 * users never land "nowhere" when a modal opens.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, enabled = true): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    // Pull focus into the trap if React's autoFocus didn't land it inside the
    // container. autoFocus runs synchronously during render, so by the time
    // this effect fires the focused element is either already inside the
    // container (good) or still outside (e.g. the document body, or the
    // trigger button the user clicked). In the latter case we defer to the
    // first focusable descendant rather than leaving the keyboard user with
    // focus on a now-obscured backdrop trigger.
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current && document.body.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [containerRef, enabled]);
}
