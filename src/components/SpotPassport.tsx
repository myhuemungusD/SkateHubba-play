import { useEffect, useState } from "react";
import { Crown, Stamp } from "lucide-react";
import { getPassportPublic, listPassport, setPassportPublic, type PassportStamp } from "../services/mapCheckins";

interface Props {
  uid: string;
  isOwner: boolean;
}

/**
 * Spot passport: every spot this skater has checked in at, with their first
 * visit. Owners always see it and choose whether others can. Visitors see it
 * only when it is public, and only public spots.
 */
export function SpotPassport({ uid, isOwner }: Props) {
  const [stamps, setStamps] = useState<PassportStamp[] | null>(null);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([listPassport(uid, isOwner), isOwner ? getPassportPublic(uid) : Promise.resolve(true)])
      .then(([list, pub]) => {
        if (!live) return;
        setStamps(list);
        setIsPublic(pub);
      })
      .catch(() => {
        if (live) setStamps([]);
      });
    return () => {
      live = false;
    };
  }, [uid, isOwner]);

  if (stamps === null) return null;
  if (!isOwner && stamps.length === 0) return null;

  const togglePublic = async () => {
    const next = !isPublic;
    setIsPublic(next);
    try {
      await setPassportPublic(uid, next);
    } catch {
      setIsPublic(!next);
    }
  };

  const legendary = stamps.filter((s) => s.legendary).length;

  return (
    <section aria-label="Spot passport" data-testid="spot-passport" className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display text-sm tracking-wider text-bright flex items-center gap-1.5">
          <Stamp size={16} aria-hidden="true" /> SPOT PASSPORT
          <span className="text-subtle font-normal">
            {stamps.length} {stamps.length === 1 ? "spot" : "spots"}
            {legendary > 0 ? ` · ${legendary} legendary` : ""}
          </span>
        </h2>
        {isOwner && (
          <label className="flex items-center gap-1.5 text-xs text-subtle">
            <input type="checkbox" checked={isPublic} onChange={togglePublic} />
            Public
          </label>
        )}
      </div>
      {stamps.length === 0 ? (
        <p className="text-xs text-subtle">Check in at a spot to get your first stamp.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {stamps.map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm text-bright">
              <span className="flex items-center gap-1.5 min-w-0 truncate">
                {s.legendary && <Crown size={14} className="text-brand-orange" aria-label="Legendary" />}
                {s.spotName}
                {s.scope === "private" && <span className="text-xs text-subtle">(private)</span>}
              </span>
              <span className="text-xs text-subtle shrink-0">
                {s.firstAt ? s.firstAt.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}
                {s.count > 1 ? ` · ${s.count}×` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
