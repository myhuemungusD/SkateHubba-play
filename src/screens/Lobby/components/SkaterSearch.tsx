import { useId, useState } from "react";
import { Search } from "lucide-react";
import { PlayerDirectory } from "../../../components/PlayerDirectory";
import { usePlayerDirectory } from "../../../hooks/usePlayerDirectory";
import { USERNAME_RE, type UserProfile } from "../../../services/users";
import { usePrefixSkaterSearch } from "../usePrefixSkaterSearch";

/** Most rows the search shows at once. */
const MAX_RESULTS = 8;

interface Props {
  viewerUid: string;
  /** False disables every Challenge button (unverified viewer). */
  canChallenge: boolean;
  /** Opens the challenge form with this username filled in. */
  onChallengeUser: (username: string) => void;
  onViewPlayer?: (uid: string) => void;
}

/** Normalize what was typed the way handles are stored: lowercase, no "@". */
export function normalizeSkaterQuery(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Results for a non-empty query. Mounted only once the skater types, so Home
 * reads nothing until someone actually searches. Two sources are merged:
 * a debounced handle-prefix lookup across every skater (older accounts too),
 * then contains-matches from the shared newest-100 directory.
 */
function SkaterSearchResults({
  query,
  viewerUid,
  canChallenge,
  onChallengeUser,
  onViewPlayer,
}: Props & { query: string }) {
  const dir = usePlayerDirectory(viewerUid);
  const prefix = usePrefixSkaterSearch(query, viewerUid);
  const matches = mergeMatches(prefix.players, dir.players, query);
  const loading = dir.loading || prefix.loading;

  if (!loading && matches.length === 0) {
    // Offer the exact handle too: the challenge form looks it up and says if
    // it doesn't exist.
    const exact = USERNAME_RE.test(query) && query.length >= 3;
    return (
      <div className="mb-6 rounded-xl border border-white/[0.06] bg-surface px-4 py-3" role="status">
        <p className="font-body text-xs text-muted">No skaters match &ldquo;{query}&rdquo;.</p>
        {exact && canChallenge && (
          <button
            type="button"
            onClick={() => onChallengeUser(query)}
            className="mt-2 min-h-[44px] inline-flex items-center rounded-lg px-1 font-display text-sm tracking-wider text-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            aria-label={`Challenge @${query}`}
          >
            Challenge @{query} →
          </button>
        )}
      </div>
    );
  }

  return (
    // Browse rows open the profile, where Challenge lives (audit #10).
    <PlayerDirectory players={matches} loading={loading && matches.length === 0} onViewPlayer={onViewPlayer} />
  );
}

/**
 * Prefix hits first, then directory handles that start with, then contain,
 * the query. Deduped by uid and capped.
 */
export function mergeMatches(prefixHits: UserProfile[], directory: UserProfile[], query: string): UserProfile[] {
  const fromDir = directory
    .filter((p) => p.username.includes(query))
    .sort((a, b) => Number(b.username.startsWith(query)) - Number(a.username.startsWith(query)));
  const seen = new Set<string>();
  const out: UserProfile[] = [];
  for (const p of [...prefixHits, ...fromDir]) {
    if (seen.has(p.uid)) continue;
    seen.add(p.uid);
    out.push(p);
  }
  return out.slice(0, MAX_RESULTS);
}

/** Home's first block: find a skater by handle and challenge them. */
export function SkaterSearch(props: Props) {
  const id = useId();
  const [raw, setRaw] = useState("");
  const query = normalizeSkaterQuery(raw);

  return (
    <section className="mb-5" aria-labelledby={`${id}-heading`} data-testid="skater-search">
      <h2 id={`${id}-heading`} className="sr-only">
        Find a skater
      </h2>
      <div className="relative mb-3 group">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-brand-orange"
        />
        <label htmlFor={`${id}-input`} className="sr-only">
          Search skaters by username
        </label>
        <input
          id={`${id}-input`}
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search skaters"
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
          enterKeyHint="search"
          className="w-full rounded-2xl border border-border bg-surface-alt/80 py-3.5 pl-10 pr-4 font-body text-base text-white outline-none transition-all duration-300 placeholder:text-subtle/60 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)]"
        />
      </div>
      {query.length > 0 && <SkaterSearchResults {...props} query={query} />}
    </section>
  );
}
