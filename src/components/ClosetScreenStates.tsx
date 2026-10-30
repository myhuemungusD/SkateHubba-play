/**
 * Full-screen placeholder states shared by the closet screens (Drop Day,
 * Trading): feature gated, loading, and load failed.
 */
export function ClosetGatedState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <p className="text-subtle">{message}</p>
    </div>
  );
}

export function ClosetLoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-orange" />
    </div>
  );
}

export function ClosetLoadErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="text-center">
        <p className="text-critical mb-4">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-brand-orange text-surface-dark rounded-lg font-display"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
