import { useEffect, useRef, useState } from "react";
import { Music, Pause } from "lucide-react";
import { getTrack } from "../../../../lib/clipEditor/musicLibrary";
import type { ProfileCustom } from "../../../../services/profileCustom";

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* v8 ignore next */
    return url;
  }
}

/**
 * Bio, stance, favorite tricks, links, sponsors and the theme song. Renders
 * nothing when the player has filled none of it in (no empty boxes on
 * someone else's profile). The song never autoplays; one tap plays it.
 */
export function ProfileAbout({ custom, stance }: { custom: ProfileCustom; stance?: string }) {
  const track = custom.themeSongId ? getTrack(custom.themeSongId) : undefined;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const toggleSong = () => {
    if (!track) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(track.src);
      audioRef.current.loop = true;
      audioRef.current.volume = 0.6;
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play()?.catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  const hasAnything =
    custom.bio || custom.favoriteTricks.length || custom.links.length || custom.sponsors.length || track;
  if (!hasAnything) return null;

  const chip =
    "inline-flex min-h-[32px] items-center rounded-full border border-white/10 bg-black/30 px-3 font-body text-xs text-white/85";

  return (
    <section aria-label="About" data-testid="profile-about" className="mb-6 space-y-3">
      {custom.bio && (
        <p className="font-body text-sm leading-relaxed text-white/90 whitespace-pre-line">{custom.bio}</p>
      )}

      {(custom.favoriteTricks.length > 0 || stance) && (
        <div className="flex flex-wrap gap-1.5" data-testid="profile-tricks">
          {stance && <span className={chip}>{stance}</span>}
          {custom.favoriteTricks.map((t) => (
            <span key={t} className={chip} style={{ borderColor: `${custom.accent}66` }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {custom.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="profile-links">
          {custom.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`${chip} hover:text-white`}
              style={{ color: custom.accent }}
              title={hostLabel(l.url)}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}

      {custom.sponsors.length > 0 && (
        <p className="font-body text-xs text-subtle" data-testid="profile-sponsors">
          <span className="font-display tracking-wider text-white/60">SPONSORS </span>
          {custom.sponsors.map((s, i) => (
            <span key={s.name}>
              {i > 0 && " · "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline text-white/85">
                  {s.name}
                </a>
              ) : (
                <span className="text-white/85">{s.name}</span>
              )}
            </span>
          ))}
        </p>
      )}

      {track && (
        <button
          type="button"
          onClick={toggleSong}
          aria-pressed={playing}
          aria-label={playing ? `Pause theme song ${track.title}` : `Play theme song ${track.title}`}
          className={`${chip} gap-1.5`}
        >
          {playing ? <Pause size={12} /> : <Music size={12} />}
          {track.title}
        </button>
      )}
    </section>
  );
}
