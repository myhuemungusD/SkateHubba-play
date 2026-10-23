import type { ReactNode } from "react";

/**
 * Pins the control that actually sends a turn (record, landed/missed, roll)
 * to the bottom of the viewport, above the home indicator.
 *
 * `inline` drops the fixed position so a screen can stack something on top of
 * the dock inside its own bottom-pinned group (the dice table does this so
 * the dice and the Roll button share the thumb zone). The look and the
 * safe-area padding stay the same.
 */
export function ActionDock({ children, testId, inline }: { children: ReactNode; testId?: string; inline?: boolean }) {
  return (
    <div className={inline ? "action-dock action-dock-inline" : "action-dock"} data-testid={testId}>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}
