import { useState } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AdminTabs, type AdminTab } from "./components/AdminTabs";
import { VerifyProPanel } from "./components/VerifyProPanel";
import { AwardsPanel } from "./components/AwardsPanel";
import { ReportsPanel } from "./components/ReportsPanel";

interface Props {
  /** The signed-in admin. Passed to every service call that records who acted. */
  adminUid: string;
  onBack: () => void;
}

/**
 * Hidden admin console at `/admin`.
 *
 * Unlisted by design: nothing in the app links here, and a non-admin who
 * guesses the URL gets the 404 screen from the route guard rather than a
 * redirect that would confirm the route exists.
 *
 * Every panel owns its own reads and refetches after each action. Nothing is
 * optimistic — an operator acting on a stale view is how a badge gets granted
 * twice or a report gets resolved by two people, so each action ends with the
 * panel showing what Firestore actually holds.
 */
export function AdminScreen({ adminUid, onBack }: Props) {
  const [tab, setTab] = useState<AdminTab>("verify");

  return (
    <div className="min-h-dvh overflow-y-auto bg-background pb-24">
      <div className="glass flex items-center justify-between border-b border-white/[0.04] px-5 pt-safe pb-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to lobby"
          className="touch-target flex items-center gap-2 rounded-lg text-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          <span className="font-body text-xs">Lobby</span>
        </button>
        <span className="flex items-center gap-2 font-display text-sm tracking-[0.2em] text-brand-orange">
          <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
          ADMIN
        </span>
        <div className="w-16" aria-hidden="true" />
      </div>

      <div className="mx-auto max-w-lg px-5 pt-6">
        <AdminTabs tab={tab} onChange={setTab} />
        {tab === "verify" && <VerifyProPanel adminUid={adminUid} />}
        {tab === "awards" && <AwardsPanel />}
        {tab === "reports" && <ReportsPanel adminUid={adminUid} />}
      </div>
    </div>
  );
}
