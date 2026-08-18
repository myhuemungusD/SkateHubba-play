import { useId } from "react";
import { Search } from "lucide-react";
import type { AdminUserLookup } from "../useAdminUserLookup";

/**
 * Username → player lookup used by both action tabs. A real `<form>` so the
 * on-screen keyboard's Go key submits, which is the only way to run a lookup
 * one-handed on a phone.
 */
export function UserLookupForm({ lookup, label }: { lookup: AdminUserLookup; label: string }) {
  const inputId = useId();

  return (
    <form
      className="mb-5"
      onSubmit={(e) => {
        e.preventDefault();
        void lookup.lookup();
      }}
    >
      <label htmlFor={inputId} className="block font-display text-[11px] tracking-[0.2em] text-dim mb-2">
        {label.toUpperCase()}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={lookup.query}
          onChange={(e) => lookup.setQuery(e.target.value)}
          placeholder="username"
          maxLength={30}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          disabled={lookup.loading}
          className="min-h-[44px] flex-1 rounded-2xl border border-border bg-surface-alt/80 px-4 py-3 font-body text-base text-white outline-none transition-all duration-300 placeholder:text-subtle/60 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={lookup.loading}
          aria-label="Look up player"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-brand-orange/40 bg-brand-orange/[0.12] px-4 font-display text-[11px] tracking-[0.2em] text-brand-orange transition-all duration-300 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
        >
          {lookup.loading ? "..." : <Search size={18} strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>
      {lookup.error && (
        <p role="alert" className="mt-2 font-body text-xs text-brand-red">
          {lookup.error}
        </p>
      )}
    </form>
  );
}
