import { useCallback, useEffect, useState } from "react";
import { BarChart3, Megaphone } from "lucide-react";
import {
  AUDIENCES,
  BODY_MAX,
  TITLE_MAX,
  createAnnouncement,
  endAnnouncement,
  fetchAnalytics,
  listAnnouncements,
  type AnalyticsSnapshot,
  type Announcement,
  type Audience,
} from "../../../services/adminInsights";

const CARD = "rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";
const H3 = "mb-3 flex items-center gap-2 font-display text-xs tracking-[0.15em] text-white";
const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-display text-[11px] tracking-wider text-white/80 hover:bg-surface-alt disabled:opacity-50";
const INPUT = "w-full rounded-lg border border-white/[0.1] bg-surface-alt px-3 py-2 font-body text-sm text-white";

const AUDIENCE_LABELS: Record<Audience, string> = { all: "Everyone", testers: "Testers", pros: "Verified pros" };

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

export function AnalyticsSection() {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      fetchAnalytics().then(
        (d) => {
          setError("");
          setData(d);
        },
        () => setError("Couldn't load analytics."),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const stats: [string, string | number][] = data
    ? [
        ["Players today", data.dailyPlayers],
        ["Players this week", data.weeklyPlayers],
        ["New players (7d)", data.newPlayers7d],
        ["Games started (7d)", data.gamesStarted7d],
        ["Games finished (7d)", data.gamesFinished7d],
        ["Clips posted (7d)", data.clipsPosted7d],
        ["Week-2 retention", `${pct(data.retention.returned, data.retention.cohort)} of ${data.retention.cohort}`],
      ]
    : [];
  return (
    <section aria-label="Analytics" className={CARD}>
      <h3 className={H3}>
        <BarChart3 size={16} /> ANALYTICS
      </h3>
      {error && <p className="mb-2 font-body text-xs text-red-300">{error}</p>}
      {!data && !error && <p className="font-body text-xs text-white/60">Loading…</p>}
      {data && (
        <dl className="grid grid-cols-2 gap-2">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-alt p-2">
              <dt className="font-body text-[11px] text-white/60">{label}</dt>
              <dd className="font-display text-lg text-white">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 font-body text-[11px] text-white/50">
        Players are counted from games played. Retention: players who joined 8–14 days ago and played in the last 7
        days.
      </p>
      <button type="button" className={`${BTN} mt-2`} onClick={() => void load()}>
        REFRESH
      </button>
    </section>
  );
}

export function AnnouncementsSection() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      listAnnouncements().then(setRows, () => {
        setRows([]);
        setError("Couldn't load announcements.");
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (
      push &&
      !window.confirm(`Send a push notification to ${AUDIENCE_LABELS[audience].toLowerCase()}? This can't be undone.`)
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await createAnnouncement({ title, body, audience, push });
      setTitle("");
      setBody("");
      setPush(false);
      setNotice(push ? "Posted. Pushes are going out now." : "Posted as an in-app banner.");
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message.endsWith(".") ? err.message : "Couldn't post that announcement.");
    } finally {
      setBusy(false);
    }
  };

  const end = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await endAnnouncement(id);
      await load();
    } catch {
      setError("Couldn't end that announcement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Announcements" className={CARD}>
      <h3 className={H3}>
        <Megaphone size={16} /> ANNOUNCEMENTS
      </h3>
      <div className="space-y-2">
        <input
          aria-label="Announcement title"
          className={INPUT}
          maxLength={TITLE_MAX}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          aria-label="Announcement message"
          className={INPUT}
          maxLength={BODY_MAX}
          placeholder="Message"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="font-body text-xs text-white/80">
            For{" "}
            <select
              aria-label="Audience"
              className="rounded-lg bg-surface-alt px-2 py-1 text-white"
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
            >
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 font-body text-xs text-white/80">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> Also send a push
          </label>
        </div>
        <button type="button" className={BTN} disabled={busy} onClick={() => void send()}>
          POST
        </button>
      </div>
      {error && <p className="mt-2 font-body text-xs text-red-300">{error}</p>}
      {notice && <p className="mt-2 font-body text-xs text-green-300">{notice}</p>}
      <ul className="mt-3 space-y-2">
        {rows?.length === 0 && <li className="font-body text-xs text-white/60">No announcements yet.</li>}
        {rows?.map((a) => (
          <li key={a.id} className="rounded-lg bg-surface-alt p-2">
            <p className="font-display text-xs text-white">{a.title}</p>
            <p className="font-body text-xs text-white/70">{a.body}</p>
            <p className="font-body text-[11px] text-white/50">
              {AUDIENCE_LABELS[a.audience]}
              {a.push ? ` · push${a.pushCount !== null ? ` to ${a.pushCount}` : ""}` : ""}
              {a.active ? " · live" : " · ended"}
            </p>
            {a.active && (
              <button type="button" className={`${BTN} mt-1`} disabled={busy} onClick={() => void end(a.id)}>
                END
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminInsightsPanel() {
  return (
    <div className="space-y-3" data-testid="admin-insights-panel">
      <AnalyticsSection />
      <AnnouncementsSection />
    </div>
  );
}
