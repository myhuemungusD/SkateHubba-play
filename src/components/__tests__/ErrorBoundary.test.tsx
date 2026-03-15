import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../ErrorBoundary";

vi.mock("../../lib/sentry", () => ({
  captureException: vi.fn(),
}));

const ThrowingChild = ({ error }: { error: Error }) => {
  throw error;
};

beforeEach(() => vi.clearAllMocks());

describe("ErrorBoundary", () => {
  // Suppress React error boundary console.error noise
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
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
    expect(screen.getByRole("button", { name: "Reload the application" })).toBeInTheDocument();
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

  it("reload button calls window.location.reload", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error("reload test")} />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reload the application" }));
    expect(reloadMock).toHaveBeenCalled();
  });
});
