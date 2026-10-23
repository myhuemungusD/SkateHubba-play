import { useEffect, useState } from "react";
import { Gavel, Star } from "lucide-react";
import {
  fetchGoldCandidates,
  fetchProQueue,
  submitGoldClip,
  submitProCall,
  type ProCallItem,
} from "../../services/proCalls";

const CARD = "rounded-2xl border border-amber-300/20 bg-surface p-4 shadow-card";
const H3 = "mb-1 flex items-center gap-2 font-display text-sm tracking-[0.15em] text-white";
const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-body text-xs text-white/90 hover:bg-surface-alt disabled:opacity-50";

interface ListProps {
  uid: string;
  title: string;
  icon: React.ReactNode;
  blurb: string;
  empty: string;
  load: () => Promise<ProCallItem[]>;
  submit: (clipId: string, uid: string, answer: string) => Promise<void>;
  done: string;
}

function CallList({ uid, title, icon, blurb, empty, load, submit, done }: ListProps) {
  const [items, setItems] = useState<ProCallItem[] | null>(null);
  const [called, setCalled] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void load().then((r) => live && setItems(r));
    return () => {
      live = false;
    };
  }, [load]);

  const call = async (clipId: string, answer: string) => {
    setError("");
    try {
      await submit(clipId, uid, answer);
      setCalled((c) => ({ ...c, [clipId]: answer }));
    } catch {
      setError("That call didn't save. It may already have one.");
    }
  };

  return (
    <section aria-label={title} className={CARD}>
      <h3 className={H3}>
        {icon} {title.toUpperCase()}
      </h3>
      <p className="mb-3 font-body text-xs text-white/70">{blurb}</p>
      {error && (
        <p role="alert" className="mb-2 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="font-body text-xs text-white/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="font-body text-xs text-white/60">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.clipId} className="rounded-xl bg-surface-alt p-3">
              {it.videoUrl && (
                <video
                  src={it.videoUrl}
                  controls
                  playsInline
                  preload="none"
                  aria-label={`Clip ${it.clipId}`}
                  className="mb-2 aspect-video w-full rounded-lg bg-black"
                />
              )}
              {called[it.clipId] ? (
                <p className="font-body text-xs text-emerald-300">
                  {done}: {called[it.clipId]}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {it.options.map((o) => (
                    <button key={o} type="button" className={BTN} onClick={() => void call(it.clipId, o)}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProReviewQueue({ uid }: { uid: string }) {
  return (
    <CallList
      uid={uid}
      title="Pro review queue"
      icon={<Gavel size={14} aria-hidden="true" />}
      blurb="Split What's That Trick votes. Watch the clip and pick the trick; your call becomes the label."
      empty="No split votes waiting. Nice."
      load={fetchProQueue}
      submit={submitProCall}
      done="Your call"
    />
  );
}

export function GoldClipAuthoring({ uid }: { uid: string }) {
  return (
    <CallList
      uid={uid}
      title="Gold clip authoring"
      icon={<Star size={14} aria-hidden="true" />}
      blurb="Mark the known-correct trick on a clip. Gold clips quietly check how reliable each voter is."
      empty="No clips to mark right now."
      load={fetchGoldCandidates}
      submit={submitGoldClip}
      done="Marked gold"
    />
  );
}
