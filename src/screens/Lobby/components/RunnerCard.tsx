import { Link } from "react-router";

/** Lobby entry for Skate Runner. Rendered only while the feature flag is on. */
export function RunnerCard() {
  return (
    <Link
      to="/play/runner"
      data-testid="runner-card"
      className="mb-5 block w-full rounded-2xl border border-white/[0.06] bg-surface px-4 py-4 text-left shadow-card hover:border-brand-orange/40"
    >
      <span className="block font-display tracking-wider text-white">Skate Runner</span>
      <span className="mt-1 block font-body text-xs text-muted">
        Endless street. This score stays in the run.
      </span>
    </Link>
  );
}
