interface Props {
  loading: boolean;
  onClick: () => void;
}

export function LoadMoreButton({ loading, onClick }: Props) {
  return (
    <div className="flex justify-center mb-6">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="px-6 py-2.5 rounded-2xl border border-border bg-surface/60 backdrop-blur-sm font-display text-sm tracking-wider text-brand-orange hover:border-brand-orange/30 hover:shadow-glow-sm hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange active:scale-[0.97]"
      >
        {loading ? "Loading..." : "Load More Games"}
      </button>
    </div>
  );
}
