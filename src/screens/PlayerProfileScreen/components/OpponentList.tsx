import { ProUsername } from "../../../components/ProUsername";
import { SkullIcon, TrophyIcon } from "../../../components/icons";
import type { OpponentRecord } from "../usePlayerProfileController";
import { SectionHeader } from "./SectionHeader";

interface Props {
  opponents: OpponentRecord[];
  currentUserUid: string;
  isOwnProfile: boolean;
  onViewPlayer?: (uid: string) => void;
}

export function OpponentList({ opponents, currentUserUid, isOwnProfile, onViewPlayer }: Props) {
  if (opponents.length === 0) return null;

  return (
    <div className="mb-8 animate-fade-in">
      <SectionHeader title={isOwnProfile ? "OPPONENTS" : "HEAD TO HEAD"} count={opponents.length} />
      <div className="space-y-2">
        {opponents.map((opp) => {
          const isTappable = !!onViewPlayer && opp.uid !== currentUserUid;
          const Wrapper = isTappable ? "button" : "div";
          return (
            <Wrapper
              key={opp.uid}
              {...(isTappable
                ? {
                    type: "button" as const,
                    onClick: () => onViewPlayer!(opp.uid),
                  }
                : {})}
              className={`flex items-center justify-between p-4 rounded-2xl glass-card transition-all duration-300 ${
                isTappable ? "w-full text-left cursor-pointer hover:border-white/[0.1]" : ""
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
                  <span className="font-display text-[11px] text-brand-orange leading-none">
                    {opp.username[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <ProUsername
                    username={opp.username}
                    isVerifiedPro={opp.isVerifiedPro}
                    className="font-display text-base text-white block leading-none truncate"
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-body text-[11px] text-brand-green">{opp.wins}W</span>
                    <span className="font-body text-[11px] text-brand-red">{opp.losses}L</span>
                    <span className="font-body text-[11px] text-subtle">
                      {opp.totalGames} {opp.totalGames === 1 ? "game" : "games"}
                    </span>
                  </div>
                </div>
              </div>
              <div
                className="shrink-0 ml-3"
                aria-label={opp.wins > opp.losses ? "You lead" : opp.wins < opp.losses ? "They lead" : "Even record"}
              >
                {opp.wins > opp.losses ? (
                  <TrophyIcon size={16} className="text-brand-green" />
                ) : opp.wins < opp.losses ? (
                  <SkullIcon size={16} className="text-brand-red" />
                ) : (
                  <span className="font-display text-[10px] tracking-wider text-subtle">EVEN</span>
                )}
              </div>
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}
