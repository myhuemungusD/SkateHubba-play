import { Btn } from "./ui/Btn";
import { MIN_AGE } from "../utils/age";
import type { CoppaOutcome } from "../utils/coppaNotice";

/**
 * Full-screen branded block shown when a user's DOB places them under the
 * COPPA minimum age. Shared between AuthScreen (email signup) and
 * ProfileSetup / the landing (Google or Apple signup) so every onboarding path
 * delivers the same terminal UX when blocking a minor.
 *
 * `outcome` is set only on the Google/Apple path, where a sign-in already
 * existed: "deleted" once it is gone, "pending" when it was signed out and
 * queued for server-side deletion. With no outcome (email path) nothing was
 * ever created. The copy states exactly what happened, never more.
 *
 * The parent owns the "Go Back" behaviour.
 */
export function CoppaBlockedCard({ onBack, outcome }: { onBack: () => void; outcome?: CoppaOutcome }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in text-center">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-5" aria-hidden="true" />
        <h2 className="font-display text-3xl text-white mb-3">Sorry!</h2>
        <p className="font-body text-sm text-muted mb-6 leading-relaxed">
          You must be at least {MIN_AGE} years old to use SkateHubba. This is required by the Children&apos;s Online
          Privacy Protection Act (COPPA).
        </p>
        <p className="font-body text-xs text-faint mb-6">{detail(outcome)}</p>
        <Btn onClick={onBack}>Go Back</Btn>
      </div>
    </div>
  );
}

function detail(outcome: CoppaOutcome | undefined): string {
  const keep = `We don't keep personal information from anyone under ${MIN_AGE}.`;
  if (outcome === "deleted")
    return `${keep} The sign-in you just used has been removed, and no SkateHubba account exists.`;
  if (outcome === "pending")
    return `${keep} You've been signed out. The sign-in you just used will be deleted, and we won't keep any of its information.`;
  return `We do not collect or store any personal information from users under ${MIN_AGE}. No account has been created.`;
}
