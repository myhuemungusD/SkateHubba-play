import { Film, MapPin, Swords, Wrench } from "lucide-react";
import type { ProProfileContent } from "../../../constants/proProfiles";
import { ProFieldText } from "../../../components/pro/ProFieldText";
import { ComingSoonCard } from "../../../components/pro/ComingSoonCard";
import { ProProfileEditor } from "../../../components/pro/ProProfileEditor";
import { useState } from "react";

interface Props {
  content: ProProfileContent;
  username: string;
  /** Real stance from the pro's user doc ("regular" / "goofy"). */
  stance: string;
  /** Pro-written bio from the user doc; empty/undefined = not written yet. */
  bio?: string;
  /** Pro-picked tricks from the user doc; undefined = never picked. */
  signatureTricks?: string[];
  /** The pro's own uid, passed only on their own profile: enables editing. */
  editableUid?: string;
  wins: number;
  losses: number;
  /** Shown as a review banner while the showcase is admin-only. */
  reviewMode: boolean;
  /** Starts a S.K.A.T.E. game against the pro. Omitted on your own profile / signed out. */
  onPlayPro?: () => void;
  /** Opens the pro-only Pro tools screen. Only passed on the pro's own profile. */
  onOpenProTools?: () => void;
}

/** "goofy" -> "Goofy"; empty -> "Not set". */
export function formatStance(stance: string): string {
  const s = stance.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Not set";
}

const H3 = "mb-2 font-display text-[11px] tracking-[0.2em] text-brand-orange";
const CARD = "mb-4 rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";

/**
 * Pro profile presentation: hero banner, bio, sponsors, signature tricks,
 * clip reel, spots, record and the "Play a pro" challenge. Content comes from
 * src/constants/proProfiles.ts; placeholder fields are tagged in the UI.
 */
export function ProShowcase({
  content,
  username,
  stance,
  bio: docBio,
  signatureTricks: docTricks,
  editableUid,
  wins,
  losses,
  reviewMode,
  onPlayPro,
  onOpenProTools,
}: Props) {
  const games = wins + losses;
  const [saved, setSaved] = useState<{ bio: string; signatureTricks: string[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const bio = (saved?.bio ?? docBio ?? "").trim();
  const tricks = saved?.signatureTricks ?? docTricks ?? content.signatureTricks;
  const canEdit = !!editableUid;
  return (
    <div data-testid="pro-showcase" className="mb-6">
      {reviewMode && (
        <p
          role="note"
          className="mb-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-body text-xs text-amber-100"
        >
          Review mode: only admins can see this pro showcase. Placeholder fields are tagged.
        </p>
      )}

      <section
        aria-label={`${content.displayName} pro banner`}
        className="relative mb-4 overflow-hidden rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-400/20 via-brand-orange/10 to-surface p-5"
      >
        <span className="pro-username font-display text-[10px] tracking-[0.3em]">✦ VERIFIED PRO</span>
        <h2 className="mt-1 font-display text-2xl tracking-wide text-white">{content.displayName}</h2>
        <p className="font-body text-xs text-white/70">@{username}</p>
        <p className="mt-3 font-body text-sm text-white">
          <ProFieldText field={content.tagline} />
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 font-body text-xs">
          <div>
            <dt className="text-white/60">Hometown</dt>
            <dd>
              <ProFieldText field={content.hometown} />
            </dd>
          </div>
          <div>
            <dt className="text-white/60">Stance</dt>
            <dd data-testid="pro-stance">{formatStance(stance)}</dd>
          </div>
        </dl>
      </section>

      {onPlayPro && (
        <button
          type="button"
          onClick={onPlayPro}
          className="mb-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-brand-orange font-display text-sm tracking-[0.15em] text-black shadow-card transition-transform active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <Swords size={16} aria-hidden="true" />
          PLAY A PRO: S.K.A.T.E. VS {content.displayName.toUpperCase()}
        </button>
      )}

      {onOpenProTools && (
        <button
          type="button"
          onClick={onOpenProTools}
          data-testid="open-pro-tools"
          className="mb-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-surface font-display text-xs tracking-[0.15em] text-amber-100 shadow-card hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <Wrench size={14} aria-hidden="true" />
          PRO TOOLS
        </button>
      )}

      {editing && editableUid ? (
        <ProProfileEditor
          uid={editableUid}
          initial={{ bio, signatureTricks: tricks }}
          onSaved={(v) => {
            setSaved(v);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        canEdit &&
        (!bio || tricks.length === 0) && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid="pro-profile-prompt"
            className="mb-4 w-full rounded-2xl border border-dashed border-amber-300/40 bg-amber-300/5 p-4 text-left font-body text-sm text-amber-100"
          >
            {!bio ? "Add your bio" : "Pick your signature tricks"}
            <span className="block text-xs text-white/60">Only you can see this until you add it.</span>
          </button>
        )
      )}

      {bio && (
        <section aria-label="Bio" className={CARD}>
          <h3 className={H3}>BIO</h3>
          <p className="whitespace-pre-line font-body text-sm leading-relaxed text-white/90">{bio}</p>
        </section>
      )}

      <section aria-label="Sponsors" className={CARD}>
        <h3 className={H3}>SPONSORS</h3>
        <ul className="flex flex-wrap gap-2">
          {content.sponsors.map((s, i) => (
            <li
              key={i}
              className="rounded-lg border border-white/[0.08] bg-surface-alt px-2.5 py-1.5 font-body text-xs"
            >
              <ProFieldText field={s} />
            </li>
          ))}
        </ul>
      </section>

      {tricks.length > 0 && (
        <section aria-label="Signature tricks" className={CARD}>
          <h3 className={H3}>SIGNATURE TRICKS</h3>
          <ol className="space-y-1.5">
            {tricks.map((t, i) => (
              <li key={t} className="flex items-center gap-2 font-body text-sm">
                <span className="font-display text-xs text-brand-orange tabular-nums">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </section>
      )}

      {canEdit && !editing && bio && tricks.length > 0 && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="edit-pro-profile"
          className="mb-4 min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-surface font-display text-xs tracking-wider text-white/80"
        >
          EDIT BIO &amp; TRICKS
        </button>
      )}

      <section aria-label="Pro record" className={CARD}>
        <h3 className={H3}>S.K.A.T.E. RECORD</h3>
        <p className="font-body text-sm text-white/90 tabular-nums">
          {games === 0 ? "No games yet. Be the first to play a pro." : `${wins}W · ${losses}L across ${games} games`}
        </p>
      </section>

      <div className="space-y-3">
        <ComingSoonCard
          icon={<Film size={16} />}
          title="Clip reel"
          description="A pinned reel of the pro's best clips, picked by them, at the top of their profile."
        />
        <ComingSoonCard
          icon={<MapPin size={16} />}
          title="Pro spots"
          description="Spots the pro skates or recommends, linked to the map with their clips from each one."
        />
      </div>
    </div>
  );
}
