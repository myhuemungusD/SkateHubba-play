import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pin, X } from "lucide-react";
import { MUSIC_TRACKS } from "../../../../lib/clipEditor/musicLibrary";
import {
  fetchPinnableClips,
  gradientCss,
  isAllowedLink,
  LIMITS,
  moveSection,
  saveProfileCustom,
  togglePinnedClip,
  type PinnableClip,
  type ProfileCustom,
  type SectionId,
} from "../../../../services/profileCustom";

const SECTION_LABELS: Record<SectionId, string> = {
  clips: "Pinned clips",
  stats: "Stats",
  closet: "Closet showcase",
  crew: "Crew",
  spots: "Spots",
};

const SWATCHES = ["#FF6B00", "#FF2D55", "#AF52DE", "#0A84FF", "#30D158", "#FFD60A", "#FFFFFF", "#1A1A1A"];

type Tab = "look" | "layout" | "about";

interface Props {
  uid: string;
  initial: ProfileCustom;
  onClose: () => void;
  onSaved: (next: ProfileCustom) => void;
}

const input =
  "w-full min-h-[40px] rounded-lg border border-white/10 bg-black/40 px-3 font-body text-sm text-white placeholder:text-white/40";
const label = "block mb-1 font-display text-[10px] tracking-[0.18em] text-white/60";

function ColorRow({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <span className={label}>{name}</span>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${name} ${c}`}
            aria-pressed={value.toUpperCase() === c}
            onClick={() => onChange(c)}
            className={`h-8 w-8 rounded-full border ${value.toUpperCase() === c ? "border-white ring-2 ring-white/60" : "border-white/20"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label={`${name} custom color`}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
        />
      </div>
    </div>
  );
}

function Slider(props: { name: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mb-3 block">
      <span className={label}>
        {props.name} · {props.value}
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-brand-orange"
      />
    </label>
  );
}

/**
 * Full-screen profile editor (VITE_FEATURE_PROFILE_CUSTOM). Three tabs keep
 * it uncluttered: Look (colors, gradient, banner crop), Layout (section
 * order, pins, showcase) and About (bio, tricks, links, sponsors, song).
 * Live preview strip at the top; nothing saves until Save.
 */
export function ProfileCustomizeSheet({ uid, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileCustom>(initial);
  const [tab, setTab] = useState<Tab>("look");
  const [clips, setClips] = useState<PinnableClip[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [newSponsor, setNewSponsor] = useState({ name: "", url: "" });
  const [newTrick, setNewTrick] = useState("");

  useEffect(() => {
    let alive = true;
    void fetchPinnableClips(uid).then((c) => {
      if (alive) setClips(c);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  const set = <K extends keyof ProfileCustom>(k: K, v: ProfileCustom[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const linkOk = newLink.label.trim().length > 0 && isAllowedLink(newLink.url.trim());
  const sponsorUrl = newSponsor.url.trim();
  const sponsorOk = newSponsor.name.trim().length > 0 && (sponsorUrl === "" || isAllowedLink(sponsorUrl));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await saveProfileCustom(uid, draft));
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize profile"
      data-testid="profile-customize-sheet"
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
    >
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button type="button" aria-label="Close" onClick={onClose} className="min-h-[44px] min-w-[44px] text-white/80">
          <X size={20} />
        </button>
        <h2 className="font-display text-sm tracking-wider text-white">CUSTOMIZE</h2>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-[44px] px-3 font-display text-xs tracking-wider disabled:opacity-50"
          style={{ color: draft.accent }}
        >
          {saving ? "SAVING" : "SAVE"}
        </button>
      </div>

      <div
        data-testid="customize-preview"
        className="mx-4 mb-3 h-16 rounded-xl border border-white/10"
        style={{ background: gradientCss(draft), boxShadow: `inset 0 -3px 0 ${draft.accent}` }}
      />

      <div role="tablist" className="mx-4 mb-3 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
        {(["look", "layout", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[36px] rounded-lg font-display text-[11px] tracking-wider ${tab === t ? "bg-white/15 text-white" : "text-white/60"}`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {error && (
          <p role="alert" className="mb-3 font-body text-xs text-red-400">
            {error}
          </p>
        )}

        {tab === "look" && (
          <div>
            <ColorRow name="Accent" value={draft.accent} onChange={(v) => set("accent", v)} />
            <ColorRow name="Gradient top" value={draft.gradientFrom} onChange={(v) => set("gradientFrom", v)} />
            <ColorRow name="Gradient bottom" value={draft.gradientTo} onChange={(v) => set("gradientTo", v)} />
            <Slider
              name="Gradient angle"
              min={0}
              max={359}
              value={draft.gradientAngle}
              onChange={(v) => set("gradientAngle", v)}
            />
            <p className={`${label} mt-6`}>BANNER CROP</p>
            <Slider
              name="Left / right"
              min={0}
              max={100}
              value={draft.bannerPosX}
              onChange={(v) => set("bannerPosX", v)}
            />
            <Slider
              name="Up / down"
              min={0}
              max={100}
              value={draft.bannerPosY}
              onChange={(v) => set("bannerPosY", v)}
            />
            <Slider name="Zoom" min={100} max={200} value={draft.bannerZoom} onChange={(v) => set("bannerZoom", v)} />
          </div>
        )}

        {tab === "layout" && (
          <div>
            <p className={label}>SECTION ORDER</p>
            <ol className="mb-6 space-y-1.5">
              {draft.sections.map((id, i) => (
                <li key={id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5">
                  <span className="font-body text-sm text-white">{SECTION_LABELS[id]}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${SECTION_LABELS[id]} up`}
                      disabled={i === 0}
                      onClick={() => set("sections", moveSection(draft.sections, id, -1))}
                      className="min-h-[36px] min-w-[36px] text-white/80 disabled:opacity-30"
                    >
                      <ArrowUp size={16} className="mx-auto" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${SECTION_LABELS[id]} down`}
                      disabled={i === draft.sections.length - 1}
                      onClick={() => set("sections", moveSection(draft.sections, id, 1))}
                      className="min-h-[36px] min-w-[36px] text-white/80 disabled:opacity-30"
                    >
                      <ArrowDown size={16} className="mx-auto" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            <label className="mb-6 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="font-body text-sm text-white">Highlight signature pieces</span>
              <input
                type="checkbox"
                checked={draft.showcaseSignature}
                onChange={(e) => set("showcaseSignature", e.target.checked)}
              />
            </label>

            <p className={label}>
              PINNED CLIPS · {draft.pinnedClipIds.length}/{LIMITS.pinnedClips}
            </p>
            {clips.length === 0 ? (
              <p className="font-body text-xs text-subtle">Post a clip to pin it here.</p>
            ) : (
              <ul className="space-y-1.5">
                {clips.map((c) => {
                  const on = draft.pinnedClipIds.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("pinnedClipIds", togglePinnedClip(draft.pinnedClipIds, c.id))}
                        className="flex w-full min-h-[40px] items-center justify-between rounded-lg bg-white/5 px-3 text-left font-body text-sm text-white"
                      >
                        <span className="truncate">{c.trickName}</span>
                        <Pin size={14} style={{ color: on ? draft.accent : "rgba(255,255,255,0.3)" }} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "about" && (
          <div>
            <label className="mb-4 block">
              <span className={label}>
                BIO · {draft.bio.length}/{LIMITS.bio}
              </span>
              <textarea
                value={draft.bio}
                maxLength={LIMITS.bio}
                rows={3}
                onChange={(e) => set("bio", e.target.value)}
                className={`${input} py-2`}
              />
            </label>

            <p className={label}>FAVORITE TRICKS</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.favoriteTricks.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() =>
                    set(
                      "favoriteTricks",
                      draft.favoriteTricks.filter((x) => x !== t),
                    )
                  }
                  className="rounded-full bg-white/10 px-3 py-1 font-body text-xs text-white"
                >
                  {t} ×
                </button>
              ))}
            </div>
            {draft.favoriteTricks.length < LIMITS.tricks && (
              <div className="mb-5 flex gap-2">
                <input
                  aria-label="New trick"
                  placeholder="Kickflip"
                  maxLength={LIMITS.trick}
                  value={newTrick}
                  onChange={(e) => setNewTrick(e.target.value)}
                  className={input}
                />
                <button
                  type="button"
                  disabled={!newTrick.trim()}
                  onClick={() => {
                    set("favoriteTricks", [...draft.favoriteTricks, newTrick.trim()]);
                    setNewTrick("");
                  }}
                  className="rounded-lg bg-white/10 px-3 font-display text-xs text-white disabled:opacity-40"
                >
                  ADD
                </button>
              </div>
            )}

            <p className={label}>LINKS & SOCIALS</p>
            <ul className="mb-2 space-y-1">
              {draft.links.map((l) => (
                <li key={l.url} className="flex items-center justify-between font-body text-xs text-white/85">
                  <span className="truncate">
                    {l.label} · {l.url}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${l.label}`}
                    onClick={() =>
                      set(
                        "links",
                        draft.links.filter((x) => x !== l),
                      )
                    }
                    className="min-h-[32px] px-2 text-white/60"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {draft.links.length < LIMITS.links && (
              <div className="mb-1 grid grid-cols-[1fr_2fr_auto] gap-2">
                <input
                  aria-label="Link label"
                  placeholder="Instagram"
                  maxLength={LIMITS.linkLabel}
                  value={newLink.label}
                  onChange={(e) => setNewLink({ ...newLink, label: e.target.value })}
                  className={input}
                />
                <input
                  aria-label="Link URL"
                  placeholder="https://instagram.com/you"
                  value={newLink.url}
                  onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                  className={input}
                />
                <button
                  type="button"
                  disabled={!linkOk}
                  onClick={() => {
                    set("links", [...draft.links, { label: newLink.label.trim(), url: newLink.url.trim() }]);
                    setNewLink({ label: "", url: "" });
                  }}
                  className="rounded-lg bg-white/10 px-3 font-display text-xs text-white disabled:opacity-40"
                >
                  ADD
                </button>
              </div>
            )}
            <p className="mb-5 font-body text-[11px] text-subtle">
              Instagram, TikTok, YouTube, X, Twitch, Spotify, SoundCloud, Linktree and shop sites.
            </p>

            <p className={label}>SPONSORS & SHOPS</p>
            <ul className="mb-2 space-y-1">
              {draft.sponsors.map((s) => (
                <li key={s.name} className="flex items-center justify-between font-body text-xs text-white/85">
                  <span className="truncate">{s.url ? `${s.name} · ${s.url}` : s.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() =>
                      set(
                        "sponsors",
                        draft.sponsors.filter((x) => x !== s),
                      )
                    }
                    className="min-h-[32px] px-2 text-white/60"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {draft.sponsors.length < LIMITS.sponsors && (
              <div className="mb-5 grid grid-cols-[1fr_2fr_auto] gap-2">
                <input
                  aria-label="Sponsor name"
                  placeholder="Shop name"
                  maxLength={LIMITS.sponsorName}
                  value={newSponsor.name}
                  onChange={(e) => setNewSponsor({ ...newSponsor, name: e.target.value })}
                  className={input}
                />
                <input
                  aria-label="Sponsor URL"
                  placeholder="https://… (optional)"
                  value={newSponsor.url}
                  onChange={(e) => setNewSponsor({ ...newSponsor, url: e.target.value })}
                  className={input}
                />
                <button
                  type="button"
                  disabled={!sponsorOk}
                  onClick={() => {
                    set("sponsors", [...draft.sponsors, { name: newSponsor.name.trim(), url: sponsorUrl }]);
                    setNewSponsor({ name: "", url: "" });
                  }}
                  className="rounded-lg bg-white/10 px-3 font-display text-xs text-white disabled:opacity-40"
                >
                  ADD
                </button>
              </div>
            )}

            <label className="block">
              <span className={label}>THEME SONG</span>
              <select
                aria-label="Theme song"
                value={draft.themeSongId}
                onChange={(e) => set("themeSongId", e.target.value)}
                className={input}
              >
                <option value="">None</option>
                {MUSIC_TRACKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} — {t.mood}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
