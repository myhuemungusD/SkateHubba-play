export function AppleButton({
  onClick,
  loading,
  disabled = false,
}: {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="group w-full flex items-center justify-center gap-3 rounded-xl bg-black text-white font-body text-sm font-semibold py-3.5 px-6 border border-white/15 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] hover:bg-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flex-shrink-0 fill-current">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
      )}
      <span>{loading ? "Signing in\u2026" : "Continue with Apple"}</span>
    </button>
  );
}
