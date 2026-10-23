import { useEffect, useState } from "react";
import { Award, Sparkles } from "lucide-react";
import {
  enterChallenge,
  listChallenges,
  listFeaturedClips,
  listPropsFor,
  type FeaturedClip,
  type ProChallenge,
  type ProProp,
} from "../../services/proCommunity";
import { fetchPinnableClips, type PinnableClip } from "../../services/profileCustom";

interface Player {
  uid: string;
  username: string;
}

function ChallengeRow({ c, player, clips }: { c: ProChallenge; player: Player; clips: PinnableClip[] }) {
  const [clipId, setClipId] = useState("");
  const [state, setState] = useState<"" | "sent" | "error">("");
  const enter = async () => {
    try {
      await enterChallenge(c.id, player, clipId);
      setState("sent");
    } catch {
      setState("error");
    }
  };
  return (
    <li className="rounded-xl bg-white/5 p-3">
      <p className="font-display text-sm text-white">
        {c.trickName} <span className="font-body text-xs text-white/60">by @{c.proUsername}</span>
      </p>
      {c.description && <p className="font-body text-xs text-white/70">{c.description}</p>}
      {state === "sent" ? (
        <p className="mt-2 font-body text-xs text-emerald-300">Make sent. Good luck.</p>
      ) : clips.length === 0 ? (
        <p className="mt-2 font-body text-xs text-white/60">Post a clip of it to enter.</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <select
            aria-label={`Your clip for ${c.trickName}`}
            value={clipId}
            onChange={(e) => setClipId(e.target.value)}
            className="min-h-11 flex-1 rounded-lg bg-black/60 px-2 font-body text-xs text-white"
          >
            <option value="">Pick your clip</option>
            {clips.map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.trickName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!clipId}
            onClick={() => void enter()}
            className="min-h-11 rounded-lg bg-brand-orange px-3 font-display text-sm text-black disabled:opacity-50"
          >
            ENTER
          </button>
        </div>
      )}
      {state === "error" && (
        <p role="alert" className="mt-1 font-body text-xs text-red-300">
          Couldn't enter. You may already have a make in.
        </p>
      )}
    </li>
  );
}

/** Feed overlay: clips pinned by pros and open pro challenges. */
export function ProPicks({ player }: { player: Player }) {
  const [open, setOpen] = useState(false);
  const [featured, setFeatured] = useState<FeaturedClip[] | null>(null);
  const [challenges, setChallenges] = useState<ProChallenge[]>([]);
  const [clips, setClips] = useState<PinnableClip[]>([]);

  useEffect(() => {
    if (!open || featured !== null) return;
    let live = true;
    void Promise.all([listFeaturedClips(), listChallenges(), fetchPinnableClips(player.uid)]).then(([f, c, mine]) => {
      if (!live) return;
      setFeatured(f);
      setChallenges(c);
      setClips(mine);
    });
    return () => {
      live = false;
    };
  }, [open, featured, player.uid]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center pt-safe">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto mt-2 flex min-h-11 items-center gap-1.5 rounded-full border border-amber-300/40 bg-black/70 px-3 font-display text-sm tracking-[0.15em] text-amber-100"
      >
        <Sparkles size={12} aria-hidden="true" /> PRO PICKS
      </button>
      {open && (
        <section
          aria-label="Pro picks"
          className="pointer-events-auto mt-2 max-h-[70dvh] w-[92%] max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-4"
        >
          {featured === null ? (
            <p className="font-body text-xs text-white/60">Loading…</p>
          ) : (
            <>
              <h2 className="mb-2 font-display text-sm tracking-[0.15em] text-amber-100">FEATURED BY PROS</h2>
              {featured.length === 0 ? (
                <p className="mb-3 font-body text-xs text-white/60">No pro picks yet.</p>
              ) : (
                <div data-scroll-x className="mb-3 flex snap-x gap-3 overflow-x-auto">
                  {featured.map((f) => (
                    <figure key={f.clipId} className="w-36 shrink-0 snap-start">
                      {f.videoUrl && (
                        <video
                          src={f.videoUrl}
                          controls
                          playsInline
                          preload="none"
                          aria-label={f.trickName || f.clipId}
                          className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
                        />
                      )}
                      <figcaption className="mt-1 truncate font-body text-label text-white/80">
                        {f.trickName} · @{f.proUsername}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <h2 className="mb-2 font-display text-sm tracking-[0.15em] text-amber-100">PRO CHALLENGES</h2>
              {challenges.length === 0 ? (
                <p className="font-body text-xs text-white/60">No open challenges.</p>
              ) : (
                <ul className="space-y-2">
                  {challenges.map((c) => (
                    <ChallengeRow key={c.id} c={c} player={player} clips={clips} />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Profile row: props stickers this skater got from pros. Renders nothing when empty. */
export function PropsRow({ uid }: { uid: string }) {
  const [props, setProps] = useState<ProProp[]>([]);
  useEffect(() => {
    let live = true;
    void listPropsFor(uid).then((p) => live && setProps(p));
    return () => {
      live = false;
    };
  }, [uid]);
  if (props.length === 0) return null;
  return (
    <section
      aria-label="Props from pros"
      className="mb-4 rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card"
    >
      <h3 className="mb-2 flex items-center gap-1.5 font-display text-sm tracking-[0.2em] text-brand-orange">
        <Award size={12} aria-hidden="true" /> PROPS FROM PROS
      </h3>
      <ul className="flex flex-wrap gap-2">
        {props.map((p) => (
          <li key={p.id} className="rounded-lg bg-surface-alt px-2.5 py-1.5 font-body text-xs" title={p.note}>
            {p.sticker} · @{p.fromUsername}
          </li>
        ))}
      </ul>
    </section>
  );
}
