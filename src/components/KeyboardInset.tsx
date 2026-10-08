import { useEffect } from "react";

function isField(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.matches("input, textarea, select");
}

/**
 * Mobile Safari does not shrink the layout viewport when the keyboard opens,
 * so a focused field near the bottom (challenge handle, profile setup, DOB)
 * stays under the keys. Publish the overlap as `--keyboard-inset` and scroll
 * the field into the middle of the visual viewport.
 */
export function KeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const publish = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const inset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
      if (inset === 0) root.style.removeProperty("--keyboard-inset");
      else root.style.setProperty("--keyboard-inset", `${inset}px`);
    };

    const onFocusIn = (event: Event) => {
      if (!isField(event.target)) return;
      const field = event.target;
      requestAnimationFrame(() => {
        if (typeof field.scrollIntoView === "function") {
          field.scrollIntoView({ block: "center", inline: "nearest" });
        }
      });
    };

    publish();
    viewport?.addEventListener("resize", publish);
    viewport?.addEventListener("scroll", publish);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      viewport?.removeEventListener("resize", publish);
      viewport?.removeEventListener("scroll", publish);
      document.removeEventListener("focusin", onFocusIn);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
  return null;
}
