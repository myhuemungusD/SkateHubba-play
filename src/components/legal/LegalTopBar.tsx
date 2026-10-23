import { BackChevron } from "../ScreenHeader";

/**
 * Top bar for the public legal pages (Terms, Privacy, Data Deletion). Uses the
 * app's one BackButton (chevron, 44×44pt) instead of a "← Back" text arrow, so
 * back looks the same everywhere (design audit, back-control standardisation).
 */
export function LegalTopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-5 pt-safe pb-2 border-b border-[#222] flex items-center gap-3">
      <BackChevron onClick={onBack} />
      <img src="/logonew.webp" alt="" draggable={false} className="h-6 w-auto select-none" aria-hidden="true" />
    </div>
  );
}
