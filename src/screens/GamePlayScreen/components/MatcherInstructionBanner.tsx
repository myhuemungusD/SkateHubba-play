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
    // One tint: the brand orange carries "your move"; green is kept for
    // landed / win results only.
    <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-surface border-brand-orange/40">
      <span className="font-display text-xl tracking-wider text-white">
        Match <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
        &apos;s {currentTrickName || "trick"}
      </span>
      {headline && <p className="font-body text-xs text-brand-orange mt-1">{headline}</p>}
    </div>
  );
}
