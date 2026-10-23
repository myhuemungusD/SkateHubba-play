import { useState } from "react";
import { X } from "lucide-react";
import { MUSIC_TRACKS } from "../../../../lib/clipEditor/musicLibrary";
import { isAllowedLink, LIMITS } from "../../../../services/profileCustom";
import { input, label, type TabProps } from "./customizeParts";

/** About tab: bio, favorite tricks, links, sponsors and theme song. */
export function CustomizeAboutTab({ draft, set }: TabProps) {
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [newSponsor, setNewSponsor] = useState({ name: "", url: "" });
  const [newTrick, setNewTrick] = useState("");
  const linkOk = newLink.label.trim().length > 0 && isAllowedLink(newLink.url.trim());
  const sponsorUrl = newSponsor.url.trim();
  const sponsorOk = newSponsor.name.trim().length > 0 && (sponsorUrl === "" || isAllowedLink(sponsorUrl));

  return (
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
            className="rounded-lg bg-white/10 px-3 font-display text-sm text-white disabled:opacity-40"
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
            className="rounded-lg bg-white/10 px-3 font-display text-sm text-white disabled:opacity-40"
          >
            ADD
          </button>
        </div>
      )}
      <p className="mb-5 font-body text-label text-subtle">
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
            className="rounded-lg bg-white/10 px-3 font-display text-sm text-white disabled:opacity-40"
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
  );
}
