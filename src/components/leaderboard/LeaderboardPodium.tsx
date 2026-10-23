import type { UserProfile } from "../../services/users";
import { ratedWinRate } from "../../constants/stats";
import { ProUsername } from "../ProUsername";
import { MEDAL_TEXT, PlayerInitial } from "./LeaderboardRow";

/**
 * DOM order is 1, 2, 3 (what a screen reader hears); `order-*` lays them out
 * 2 · 1 · 3 so first place stands in the middle and tallest.
 */
const SLOTS = [
  { order: "order-2", plinth: "h-20", avatar: "h-14 w-14" },
  { order: "order-1", plinth: "h-14", avatar: "h-12 w-12" },
  { order: "order-3", plinth: "h-10", avatar: "h-12 w-12" },
] as const;

interface Props {
  top: UserProfile[];
  viewerUid: string;
  onViewPlayer?: (uid: string) => void;
}

/** Top-three podium above the list, as in Duolingo leagues. */
export function LeaderboardPodium({ top, viewerUid, onViewPlayer }: Props) {
  return (
    <ol aria-label="Top three" className="mb-4 grid grid-cols-3 items-end gap-2">
      {SLOTS.map(({ order, plinth, avatar }, index) => {
        const p = top[index];
        const rate = ratedWinRate(p.wins, p.losses);
        const content = (
          <>
            <PlayerInitial player={p} isYou={p.uid === viewerUid} size={avatar} />
            <ProUsername
              username={p.username}
              isVerifiedPro={p.isVerifiedPro}
              className="mt-1.5 block max-w-full truncate font-body text-sm font-semibold text-white"
            />
            <span className="font-body text-xs text-muted">{rate === null ? "Provisional" : `${rate}% win rate`}</span>
            <span
              className={`mt-2 flex w-full items-start justify-center rounded-t-xl border border-b-0 border-border bg-surface pt-2 font-display text-2xl leading-none ${plinth} ${MEDAL_TEXT[index]}`}
            >
              <span className="sr-only">Rank </span>
              {index + 1}
            </span>
          </>
        );
        const cell = "flex w-full min-w-0 flex-col items-center";
        return (
          <li key={p.uid} className={`min-w-0 ${order}`}>
            {onViewPlayer ? (
              <button
                type="button"
                onClick={() => onViewPlayer(p.uid)}
                className={`${cell} rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange`}
              >
                {content}
              </button>
            ) : (
              <div className={cell}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
