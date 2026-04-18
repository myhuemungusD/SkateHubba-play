import { Component, type ReactNode } from "react";
import { captureException } from "../lib/sentry";
import { logger } from "../services/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  retryAttempted: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryAttempted: false };

  static getDerivedStateFromError(error: Error): Pick<State, "error"> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    captureException(error, { extra: { componentStack: info.componentStack } });
    logger.error("error_boundary_caught", { error: error.message, componentStack: info.componentStack ?? "" });
  }

  // Recovery order matches MapErrorBoundary: try an in-app remount first
  // (cheap, preserves app state). Only surface the full-page reload after
  // that attempt has already failed, so the hard reload is a last resort
  // rather than the default terminal CTA.
  handleRetry = () => {
    this.setState({ error: null, retryAttempted: true });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      const showReload = this.state.retryAttempted;
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
          <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
          <h1 className="font-display text-3xl text-white mb-2">Something broke</h1>
          <p className="font-body text-sm text-muted mb-6 text-center max-w-sm">{this.state.error.message}</p>
          <div className="flex flex-col items-stretch gap-2 w-full max-w-xs">
            <button
              type="button"
              aria-label="Try again"
              onClick={this.handleRetry}
              className="px-6 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              Try again
            </button>
            {showReload && (
              <button
                type="button"
                aria-label="Reload the application"
                onClick={() => window.location.reload()}
                className="px-6 py-2 text-dim hover:text-white font-body text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                Reload app
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
