import { RecordFigure } from "../../../components/RecordFigure";
import { useCallback, useEffect, useState } from "react";
import { Ban, Flag, Users } from "lucide-react";
import {
  getFeatureTesterUids,
  getUserSummary,
  listBans,
  searchUsers,
  type BanRow,
  type UserSearchRow,
  type UserSummary,
} from "../../../services/admin.console";
import { unbanUser } from "../../../services/admin.bans";
import { readFeatureSwitches } from "../../../lib/featureSwitches";

const CARD = "rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";
const H3 = "mb-3 flex items-center gap-2 font-display text-sm tracking-[0.15em] text-white";
const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-display text-sm tracking-wider text-white/80 hover:bg-surface-alt disabled:opacity-50";

export function BansListSection() {
  const [rows, setRows] = useState<BanRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(
    () =>
      listBans().then(setRows, () => {
        setRows([]);
        setError("Couldn't load bans.");
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const lift = async (uid: string) => {
    setBusy(uid);
    setError("");
    try {
      await unbanUser(uid);
      await load();
    } catch {
      setError("Couldn't lift that ban.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-label="Bans list" className={CARD}>
      <h3 className={H3}>
        <Ban size={14} aria-hidden="true" /> BANS LIST
      </h3>
      {error && (
        <p role="alert" className="mb-2 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      {rows === null ? (
        <p className="font-body text-xs text-white/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-body text-xs text-white/60">Nobody is banned.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.uid} className="flex items-start justify-between gap-2 rounded-xl bg-surface-alt p-3">
              <div className="min-w-0 font-body text-xs">
                <p className="text-white">@{r.username || r.uid}</p>
                <p className="text-white/60">
                  By @{r.bannedByUsername || r.bannedBy || "unknown"}
                  {r.bannedAtMs ? ` · ${new Date(r.bannedAtMs).toLocaleDateString()}` : ""}
                </p>
                {r.reason && <p className="text-white/80">{r.reason}</p>}
              </div>
              <button type="button" className={BTN} disabled={busy === r.uid} onClick={() => void lift(r.uid)}>
                LIFT BAN
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UserSearchSection() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<UserSearchRow[] | null>(null);
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setError("");
    setSummary(null);
    try {
      setResults(await searchUsers(term));
    } catch {
      setResults([]);
      setError("Search failed.");
    }
  };

  const open = async (uid: string) => {
    setError("");
    try {
      const s = await getUserSummary(uid);
      if (!s) setError("That player has no profile.");
      setSummary(s);
    } catch {
      setError("Couldn't load that player.");
    }
  };

  return (
    <section aria-label="User search" className={CARD}>
      <h3 className={H3}>
        <Users size={14} aria-hidden="true" /> USER SEARCH
      </h3>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          aria-label="Username"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="username"
          className="min-h-[36px] flex-1 rounded-lg border border-white/[0.1] bg-surface-alt px-3 font-body text-sm text-white"
        />
        <button type="submit" className={BTN}>
          SEARCH
        </button>
      </form>
      {error && (
        <p role="alert" className="mb-2 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      {results && results.length === 0 && !error && (
        <p className="font-body text-xs text-white/60">No players match.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {results.map((r) => (
            <li key={r.uid}>
              <button type="button" className={BTN} onClick={() => void open(r.uid)}>
                @{r.username}
              </button>
            </li>
          ))}
        </ul>
      )}
      {summary && (
        <dl
          data-testid="user-summary"
          className="grid grid-cols-2 gap-2 rounded-xl bg-surface-alt p-3 font-body text-xs"
        >
          <dt className="text-white/60">Player</dt>
          <dd>@{summary.username}</dd>
          <dt className="text-white/60">Record</dt>
          <dd>
            <RecordFigure wins={summary.wins} games={summary.wins + summary.losses} caption="won" />
          </dd>
          <dt className="text-white/60">Reports against</dt>
          <dd>
            {summary.reportsAgainst} ({summary.openReportsAgainst} open)
          </dd>
          <dt className="text-white/60">Badges</dt>
          <dd>{summary.badges}</dd>
          <dt className="text-white/60">Status</dt>
          <dd>
            {[summary.isVerifiedPro ? "Verified pro" : "", summary.isBanned ? "Banned" : ""]
              .filter(Boolean)
              .join(", ") || "Active"}
          </dd>
        </dl>
      )}
    </section>
  );
}

export function FeatureSwitchesSection() {
  const [testers, setTesters] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void getFeatureTesterUids().then((t) => live && setTesters(t));
    return () => {
      live = false;
    };
  }, []);
  const switches = readFeatureSwitches();
  return (
    <section aria-label="Feature switches" className={CARD}>
      <h3 className={H3}>
        <Flag size={14} aria-hidden="true" /> FEATURE SWITCHES
      </h3>
      <p className="mb-2 font-body text-xs text-white/70">
        On = live for everyone in this build. Tester-only = off for everyone, on for the testers below. Change a switch
        in Vercel and redeploy.
      </p>
      <ul className="mb-3 grid grid-cols-1 gap-1">
        {switches.map((s) => (
          <li key={s.key} className="flex items-center justify-between font-body text-xs">
            <span className="text-white/90">{s.label}</span>
            <span className={s.on ? "text-emerald-300" : "text-amber-200"}>{s.on ? "On" : "Tester-only"}</span>
          </li>
        ))}
      </ul>
      <p className="font-body text-xs text-white/60">
        Testers: {testers === null ? "loading…" : testers.length === 0 ? "none" : testers.join(", ")}
      </p>
    </section>
  );
}

/** Admin console sections (admin claim only; the Admin screen is route-guarded). */
export function AdminConsolePanel() {
  return (
    <div className="mb-6 space-y-3" data-testid="admin-console-panel">
      <BansListSection />
      <UserSearchSection />
      <FeatureSwitchesSection />
    </div>
  );
}
