import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { NotificationProvider } from "../../../../context/NotificationContext";
import { ToastContainer } from "../../../../components/ToastContainer";

/** Uid every panel spec acts as — the console always passes its own admin. */
export const ADMIN_UID = "admin1";

/**
 * Provider tree the admin panels need. ToastContainer is mounted alongside so
 * specs assert the toast an operator actually sees rather than reaching into
 * the notification context.
 */
export function ToastWrapper({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider uid={ADMIN_UID}>
      {children}
      <ToastContainer />
    </NotificationProvider>
  );
}

export function renderWithToasts(ui: ReactElement) {
  return render(ui, { wrapper: ToastWrapper });
}
