import { Btn } from "./ui/Btn";
import { MIN_AGE } from "../utils/age";

/**
 * Full-screen branded block shown when a user's DOB places them under the
 * COPPA minimum age. Shared between AuthScreen (email signup) and
 * ProfileSetup (Google signup fallback) so the two onboarding paths deliver
 * the same terminal UX when blocking a minor.
 *
 * The parent owns the "Go Back" behaviour (typically: clear DOB state and
 * return the form to its pre-submit shape).
 */
export function CoppaBlockedCard({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in text-center">
        <img src="/logo.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-5" aria-hidden="true" />
        <h2 className="font-display text-3xl text-white mb-3">Sorry!</h2>
        <p className="font-body text-sm text-muted mb-6 leading-relaxed">
          You must be at least {MIN_AGE} years old to use SkateHubba. This is required by the Children&apos;s Online
          Privacy Protection Act (COPPA).
        </p>
        <p className="font-body text-xs text-faint mb-6">
          We do not collect or store any personal information from users under {MIN_AGE}. No account has been created.
        </p>
        <Btn onClick={onBack}>Go Back</Btn>
      </div>
    </div>
  );
}
