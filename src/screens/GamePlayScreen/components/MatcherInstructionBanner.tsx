import { ProUsername } from "../../../components/ProUsername";
import { trickCategoryHeadline, type TrickCategoryId } from "../../../constants/trickCategories";

interface Props {
  setterUsername: string;
  setterIsPro: boolean | undefined;
  currentTrickName: string | null | undefined;
  trickCategory: TrickCategoryId | undefined;
  customRules: string | null | undefined;
}

export function MatcherInstructionBanner({
  setterUsername,
  setterIsPro,
  currentTrickName,
  trickCategory,
  customRules,
}: Props) {
  const headline = trickCategoryHeadline(trickCategory, customRules);
  return (
    <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-brand-green/[0.06] backdrop-blur-sm border-brand-green/30 shadow-[0_0_20px_rgba(0,230,118,0.06)]">
      <span className="font-display text-xl tracking-wider text-brand-green">
        Match <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
        &apos;s {currentTrickName || "trick"}
      </span>
      {headline && <p className="font-body text-xs text-brand-green/80 mt-1">{headline}</p>}
    </div>
  );
}
