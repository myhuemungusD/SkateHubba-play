import { ProUsername } from "../../../components/ProUsername";

interface Props {
  username: string;
  isVerifiedPro: boolean | undefined;
  stance: string;
}

export function ProfileIdentityCard({ username, isVerifiedPro, stance }: Props) {
  return (
    <div className="flex items-center gap-4 mb-8 animate-fade-in">
      <div className="w-14 h-14 rounded-full bg-brand-orange/[0.12] border-2 border-brand-orange/30 flex items-center justify-center shrink-0 shadow-glow-sm">
        <span className="font-display text-xl text-brand-orange leading-none">{username[0].toUpperCase()}</span>
      </div>
      <div>
        <h1 className="font-display text-3xl text-white leading-none tracking-wide">
          <ProUsername username={username} isVerifiedPro={isVerifiedPro} />
        </h1>
        <p className="font-body text-xs text-muted mt-1.5 capitalize">{stance}</p>
      </div>
    </div>
  );
}
