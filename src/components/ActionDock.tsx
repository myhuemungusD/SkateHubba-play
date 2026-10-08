import type { ReactNode } from "react";

/**
 * Pins the control that actually sends a turn (record, landed/missed, roll)
 * to the bottom of the viewport, above the home indicator.
 */
export function ActionDock({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="action-dock" data-testid={testId}>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}
