import { Link } from "react-router";

/** Lobby entry for the Trick Library. Rendered only while its flag is on. */
export function TrickLibraryCard() {
  return (
    <Link
      to="/tricks"
      data-testid="trick-library-card"
      className="mb-5 block w-full rounded-2xl border border-white/[0.06] bg-surface px-4 py-4 text-left shadow-card hover:border-brand-orange/40"
    >
      <span className="block font-display tracking-wider text-white">Trick Library</span>
      <span className="mt-1 block font-body text-xs text-muted">Look up tricks, vote, and add your own.</span>
    </Link>
  );
}
