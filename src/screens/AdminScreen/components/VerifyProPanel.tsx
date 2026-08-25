import { useState } from "react";
import { BadgeCheck, ShieldOff } from "lucide-react";
import { grantVerifiedPro, revokeVerifiedPro } from "../../../services/admin";
import { useNotifications } from "../../../context/NotificationContext";
import { useAdminUserLookup } from "../useAdminUserLookup";
import { errorMessage } from "../utils";
import { UserLookupForm } from "./UserLookupForm";
import { ConfirmButton } from "./ConfirmButton";

/**
 * Verified Pro grant/revoke. Verification is human-approved, audited and
 * revocable (ECONOMY.md), so both directions are two-step and both refetch
 * the profile afterwards rather than flipping a local flag — the badge the
 * operator sees is always the one Firestore actually holds.
 */
export function VerifyProPanel({ adminUid }: { adminUid: string }) {
  const lookup = useAdminUserLookup();
  const { notify } = useNotifications();
  const [acting, setActing] = useState(false);

  const target = lookup.target;
  const isPro = target?.isVerifiedPro === true;

  const run = async (grant: boolean): Promise<void> => {
    if (!target) return;
    setActing(true);
    try {
      if (grant) {
        await grantVerifiedPro(adminUid, target.uid);
      } else {
        await revokeVerifiedPro(adminUid, target.uid);
      }
      notify({
        type: "success",
        title: grant ? "Verified Pro granted" : "Verified Pro revoked",
        message: `@${target.username}`,
      });
      await lookup.refresh();
    } catch (err: unknown) {
      notify({
        type: "error",
        title: grant ? "Grant failed" : "Revoke failed",
        message: errorMessage(err),
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <section aria-label="Verify Pro">
      <UserLookupForm lookup={lookup} label="Player username" />

      {target && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-4 flex items-center gap-2">
            {isPro ? (
              <BadgeCheck size={18} strokeWidth={2} className="text-brand-orange" aria-hidden="true" />
            ) : (
              <ShieldOff size={18} strokeWidth={2} className="text-subtle" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-base text-white">@{target.username}</p>
              <p className="font-body text-xs text-subtle" data-testid="verify-pro-status">
                {isPro ? "Verified Pro" : "Not verified"}
              </p>
            </div>
          </div>

          {isPro ? (
            <ConfirmButton
              label="Revoke"
              question={`Revoke Verified Pro from @${target.username}?`}
              confirmLabel="Revoke"
              tone="danger"
              loading={acting}
              onConfirm={() => void run(false)}
            />
          ) : (
            <ConfirmButton
              label="Grant"
              question={`Grant Verified Pro to @${target.username}?`}
              confirmLabel="Grant"
              loading={acting}
              onConfirm={() => void run(true)}
            />
          )}
        </div>
      )}
    </section>
  );
}
