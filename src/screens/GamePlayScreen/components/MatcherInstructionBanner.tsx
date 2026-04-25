import { ProUsername } from "../../../components/ProUsername";

interface Props {
  setterUsername: string;
  setterIsPro: boolean | undefined;
  currentTrickName: string | null | undefined;
}

export function MatcherInstructionBanner({ setterUsername, setterIsPro, currentTrickName }: Props) {
  return (
    <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-brand-green/[0.06] backdrop-blur-sm border-brand-green/30 shadow-[0_0_20px_rgba(0,230,118,0.06)]">
      <span className="font-display text-xl tracking-wider text-brand-green">
        Match <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
        &apos;s {currentTrickName || "trick"}
      </span>
    </div>
  );
}
