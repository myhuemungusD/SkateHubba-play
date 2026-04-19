import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../ErrorBoundary";

vi.mock("../../lib/sentry", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const ThrowingChild = ({ error }: { error: Error }) => {
  throw error;
};

beforeEach(() => vi.clearAllMocks());

describe("ErrorBoundary", () => {
  // React 18 re-throws caught errors to the global error event in dev mode.
  // Suppress both console.error noise and the window error event so Vitest
  // doesn't count them as unhandled test failures.
  const originalError = console.error;
  const suppressWindowError = (e: ErrorEvent) => e.preventDefault();
  beforeEach(() => {
    console.error = vi.fn();
    window.addEventListener("error", suppressWindowError);
  });
  afterEach(() => {
    console.error = originalError;
    window.removeEventListener("error", suppressWindowError);
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders default fallback UI on error", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error("Test explosion")} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("Test explosion")).toBeInTheDocument();
    // In-app remount is the primary action; the hard-reload escape hatch
    // is only surfaced after an in-app retry has already failed.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload the application" })).not.toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild error={new Error("boom")} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something broke")).not.toBeInTheDocument();
  });

  it("reports error to Sentry via componentDidCatch", async () => {
    const { captureException } = await import("../../lib/sentry");
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error("sentry test")} />
      </ErrorBoundary>,
    );
    expect(captureException).toHaveBeenCalled();
  });

  it("Try again attempts in-app recovery without a full page reload", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });

    // Throw once, then start rendering successfully. Simulates a transient
    // failure that the in-app retry can actually recover from.
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error("transient failure");
      return <div>Recovered</div>;
    };

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something broke")).toBeInTheDocument();

    // Clear the underlying fault before the user taps Try again — on the
    // re-render the boundary resets and Flaky renders its recovered output.
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("surfaces Reload app only after an in-app retry has failed, then reloads", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error("persistent failure")} />
      </ErrorBoundary>,
    );

    // First trip — only Try again is offered.
    expect(screen.queryByRole("button", { name: "Reload the application" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    // Boundary re-trips on the persistent error; now the hard-reload escape
    // hatch appears as the genuine last resort.
    const reloadBtn = await screen.findByRole("button", { name: "Reload the application" });
    await userEvent.click(reloadBtn);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
