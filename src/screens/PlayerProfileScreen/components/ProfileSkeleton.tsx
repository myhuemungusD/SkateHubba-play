import { ProfileHeader } from "./ProfileHeader";

export function ProfileSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div
      className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow"
      role="status"
      aria-busy="true"
      aria-label="Loading player profile"
    >
      <ProfileHeader onBack={onBack} />

      <div className="px-5 pt-7 max-w-lg mx-auto animate-pulse">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-full bg-surface-alt border border-border shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-40 rounded-md bg-surface-alt" />
            <div className="h-3 w-20 rounded-md bg-surface-alt/70" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface-alt/60 border border-border" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2.5 mb-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface-alt/60 border border-border" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2.5 mb-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface-alt/60 border border-border" />
          ))}
        </div>

        <div className="h-4 w-24 rounded-md bg-surface-alt/60 mb-3" />
        <div className="space-y-2 mb-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[68px] rounded-2xl bg-surface-alt/60 border border-border" />
          ))}
        </div>

        <div className="h-4 w-32 rounded-md bg-surface-alt/60 mb-3" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[72px] rounded-2xl bg-surface-alt/60 border border-border" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading player profile…</span>
    </div>
  );
}
