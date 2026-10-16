import { ArrowLeft } from "lucide-react";
import { ComingSoonCard } from "../../components/pro/ComingSoonCard";
import { PRO_TOOLS } from "../../components/pro/proTools";
import { BlessingHero } from "../../components/pro/BlessingHero";
import { useIsAdmin } from "../../hooks/useIsAdmin";
import { isProBlessingEnabled, isProProfilesEnabled } from "../../lib/featureFlags";
import { NotFound } from "../NotFound";
import { Spinner } from "../../components/ui/Spinner";
import { resolveProToolsAccess } from "./access";

interface ScreenProps {
  uid?: string | null;
  reviewMode: boolean;
  onBack: () => void;
}

/**
 * Pro-only toolset. Deliberately imports nothing from the admin console or
 * admin services: a pro reaches these tools without the admin claim, so no
 * ban, report, moderation, verify-pro or award control can render here.
 */
export function ProToolsScreen({ uid = null, reviewMode, onBack }: ScreenProps) {
  return (
    <div className="mx-auto min-h-dvh max-w-lg px-5 pb-24 pt-6" data-testid="pro-tools-screen">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex min-h-[44px] items-center gap-2 font-display text-xs tracking-wider text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        BACK
      </button>
      <span className="pro-username font-display text-[10px] tracking-[0.3em]">✦ VERIFIED PRO</span>
      <h1 className="mt-1 mb-2 font-display text-2xl tracking-wide text-white">Pro tools</h1>
      <p className="mb-4 font-body text-sm text-white/70">
        Your toolkit for shaping SkateHubba. Each tool launches to testers first.
      </p>
      {reviewMode && (
        <p
          role="note"
          className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-body text-xs text-amber-100"
        >
          Review mode: you are seeing what verified pros will see. Pros get these tools without admin access.
        </p>
      )}
      <BlessingHero uid={uid} live={!reviewMode && isProBlessingEnabled()} />
      <div className="space-y-3">
        {PRO_TOOLS.map((t) => (
          <ComingSoonCard key={t.title} icon={t.icon} title={t.title} description={t.description} status={t.status} />
        ))}
      </div>
    </div>
  );
}

interface RouteProps {
  uid: string | null;
  isVerifiedPro: boolean;
  onBack: () => void;
}

/** Guard for /pro. Unknown viewers get NotFound, not a redirect, like /admin. */
export function ProToolsRoute({ uid, isVerifiedPro, onBack }: RouteProps) {
  const flagOn = isProProfilesEnabled();
  const proOpen = flagOn && isVerifiedPro;
  // Only consult the admin claim when the pro path doesn't already open it.
  const { isAdmin, loading } = useIsAdmin(uid && !proOpen ? uid : "");
  if (!uid) return <NotFound onBack={onBack} />;
  if (!proOpen && loading) return <Spinner />;
  const access = resolveProToolsAccess({ flagOn, isVerifiedPro, isAdmin });
  if (!access) return <NotFound onBack={onBack} />;
  return <ProToolsScreen uid={uid} reviewMode={access === "review"} onBack={onBack} />;
}
