import { Film, MapPin, Swords } from "lucide-react";
import type { ProProfileContent } from "../../../constants/proProfiles";
import { ProFieldText } from "../../../components/pro/ProFieldText";
import { ComingSoonCard } from "../../../components/pro/ComingSoonCard";

interface Props {
  content: ProProfileContent;
  username: string;
  wins: number;
  losses: number;
  /** Shown as a review banner while the showcase is admin-only. */
  reviewMode: boolean;
  /** Starts a S.K.A.T.E. game against the pro. Omitted on your own profile / signed out. */
  onPlayPro?: () => void;
}

const H3 = "mb-2 font-display text-[11px] tracking-[0.2em] text-brand-orange";
const CARD = "mb-4 rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";

/**
 * Pro profile presentation: hero banner, bio, sponsors, signature tricks,
 * clip reel, spots, record and the "Play a pro" challenge. Content comes from
 * src/constants/proProfiles.ts; placeholder fields are tagged in the UI.
 */
export function ProShowcase({ content, username, wins, losses, reviewMode, onPlayPro }: Props) {
  const games = wins + losses;
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
            <dd>
              <ProFieldText field={content.stance} />
            </dd>
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

      <section aria-label="Bio" className={CARD}>
        <h3 className={H3}>BIO</h3>
        <p className="font-body text-sm leading-relaxed text-white/90">
          <ProFieldText field={content.bio} />
        </p>
      </section>

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

      <section aria-label="Signature tricks" className={CARD}>
        <h3 className={H3}>SIGNATURE TRICKS</h3>
        <ol className="space-y-1.5">
          {content.signatureTricks.map((t, i) => (
            <li key={i} className="flex items-center gap-2 font-body text-sm">
              <span className="font-display text-xs text-brand-orange tabular-nums">{i + 1}</span>
              <ProFieldText field={t} />
            </li>
          ))}
        </ol>
      </section>

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
