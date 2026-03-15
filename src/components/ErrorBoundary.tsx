import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    console.error("ErrorBoundary caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
          <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
          <h1 className="font-display text-3xl text-white mb-2">Something broke</h1>
          <p className="font-body text-sm text-[#888] mb-6 text-center max-w-sm">{this.state.error.message}</p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="px-6 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
