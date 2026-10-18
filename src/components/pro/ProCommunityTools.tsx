import { useCallback, useEffect, useState } from "react";
import { Award, Sparkles, Swords } from "lucide-react";
import {
  MAX_FEATURED_PER_PRO,
  PROP_STICKERS,
  createChallenge,
  featureClip,
  giveProps,
  listChallenges,
  listEntries,
  listFeaturedClips,
  setEntryFeatured,
  unfeatureClip,
  type ChallengeEntry,
  type FeaturedClip,
  type PropSticker,
  type ProChallenge,
} from "../../services/proCommunity";

const CARD = "rounded-2xl border border-amber-300/20 bg-surface p-4 shadow-card";
const H3 = "mb-1 flex items-center gap-2 font-display text-xs tracking-[0.15em] text-white";
const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-body text-xs text-white/90 hover:bg-surface-alt disabled:opacity-50";
const INPUT =
  "min-h-[36px] w-full rounded-lg border border-white/[0.1] bg-surface-alt px-3 font-body text-sm text-white";

interface Pro {
  uid: string;
  username: string;
}

function Status({ error, ok }: { error: string; ok: string }) {
  if (error)
    return (
      <p role="alert" className="mt-2 font-body text-xs text-red-300">
        {error}
      </p>
    );
  return ok ? <p className="mt-2 font-body text-xs text-emerald-300">{ok}</p> : null;
}

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function EntriesList({ challengeId }: { challengeId: string }) {
  const [entries, setEntries] = useState<ChallengeEntry[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => listEntries(challengeId).then(setEntries), [challengeId]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (e: ChallengeEntry) => {
    setError("");
    try {
      await setEntryFeatured(e.id, !e.featured);
      await load();
    } catch {
      setError("Couldn't update that make.");
    }
  };
  if (entries === null) return <p className="font-body text-xs text-white/60">Loading makes…</p>;
  if (entries.length === 0) return <p className="font-body text-xs text-white/60">No makes yet.</p>;
  return (
    <>
      <ul className="mt-2 space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 font-body text-xs">
            <span>
              @{e.username} {e.featured ? "· featured" : ""}
            </span>
            <button type="button" className={BTN} onClick={() => void toggle(e)}>
              {e.featured ? "Unfeature" : "Feature"}
            </button>
          </li>
        ))}
      </ul>
      <Status error={error} ok="" />
    </>
  );
}

export function ProChallengesTool({ pro }: { pro: Pro }) {
  const [trick, setTrick] = useState("");
  const [desc, setDesc] = useState("");
  const [mine, setMine] = useState<ProChallenge[] | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const load = useCallback(
    () => listChallenges().then((all) => setMine(all.filter((c) => c.proUid === pro.uid))),
    [pro.uid],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const post = async () => {
    setError("");
    setOk("");
    try {
      await createChallenge(pro, trick, desc);
      setTrick("");
      setDesc("");
      setOk("Challenge posted.");
      await load();
    } catch (e) {
      setError(msg(e, "Couldn't post that challenge."));
    }
  };
  return (
    <section aria-label="Pro challenges" className={CARD}>
      <h3 className={H3}>
        <Swords size={14} aria-hidden="true" /> PRO CHALLENGES
      </h3>
      <p className="mb-3 font-body text-xs text-white/70">
        Post a trick for the community to match. Feature the best makes for a pro shout-out (never a pro badge).
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <input
          aria-label="Trick"
          className={INPUT}
          value={trick}
          onChange={(e) => setTrick(e.target.value)}
          placeholder="Trick"
        />
        <input
          aria-label="Details"
          className={INPUT}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Details (optional)"
        />
        <button type="submit" className={BTN}>
          POST CHALLENGE
        </button>
      </form>
      <Status error={error} ok={ok} />
      {mine && mine.length > 0 && (
        <ul className="mt-3 space-y-3">
          {mine.map((c) => (
            <li key={c.id} className="rounded-xl bg-surface-alt p-3">
              <p className="font-display text-sm text-white">{c.trickName}</p>
              <EntriesList challengeId={c.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProPropsTool({ pro }: { pro: Pro }) {
  const [to, setTo] = useState("");
  const [sticker, setSticker] = useState<PropSticker>("fire");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const send = async () => {
    setError("");
    setOk("");
    try {
      await giveProps(pro, to, sticker, note);
      setOk(`Props sent to @${to.replace(/^@/, "")}.`);
      setTo("");
      setNote("");
    } catch (e) {
      setError(msg(e, "Couldn't send props."));
    }
  };
  return (
    <section aria-label="Pro props" className={CARD}>
      <h3 className={H3}>
        <Award size={14} aria-hidden="true" /> PRO PROPS
      </h3>
      <p className="mb-3 font-body text-xs text-white/70">
        Give a signature props sticker to a skater who beat you or nailed your trick. Props are not pro status.
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          aria-label="Skater username"
          className={INPUT}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="@username"
        />
        <select
          aria-label="Sticker"
          className={INPUT}
          value={sticker}
          onChange={(e) => setSticker(e.target.value as PropSticker)}
        >
          {PROP_STICKERS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <input
          aria-label="Note"
          className={INPUT}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
        />
        <button type="submit" className={BTN}>
          GIVE PROPS
        </button>
      </form>
      <Status error={error} ok={ok} />
    </section>
  );
}

export function FeaturedClipsTool({ pro }: { pro: Pro }) {
  const [clipId, setClipId] = useState("");
  const [mine, setMine] = useState<FeaturedClip[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () => listFeaturedClips().then((all) => setMine(all.filter((f) => f.proUid === pro.uid))),
    [pro.uid],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(msg(e, fallback));
    }
  };
  return (
    <section aria-label="Featured clips" className={CARD}>
      <h3 className={H3}>
        <Sparkles size={14} aria-hidden="true" /> FEATURED CLIPS
      </h3>
      <p className="mb-3 font-body text-xs text-white/70">
        Pin up to {MAX_FEATURED_PER_PRO} clips to the top of the feed under Pro picks. Your profile reel uses your
        pinned clips.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await featureClip(pro, clipId);
            setClipId("");
          }, "Couldn't feature that clip.");
        }}
      >
        <input
          aria-label="Clip id"
          className={INPUT}
          value={clipId}
          onChange={(e) => setClipId(e.target.value)}
          placeholder="Clip id"
        />
        <button type="submit" className={BTN}>
          FEATURE
        </button>
      </form>
      <Status error={error} ok="" />
      {mine && mine.length > 0 && (
        <ul className="mt-3 space-y-1">
          {mine.map((f) => (
            <li key={f.clipId} className="flex items-center justify-between font-body text-xs">
              <span>{f.trickName || f.clipId}</span>
              <button
                type="button"
                className={BTN}
                onClick={() => void run(() => unfeatureClip(f.clipId), "Couldn't unpin that clip.")}
              >
                Unpin
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
