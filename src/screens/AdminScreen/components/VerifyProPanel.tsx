import { useState } from "react";
import { BadgeCheck, ShieldOff } from "lucide-react";
import {
  SEED_COMPANY_MAX,
  SEED_REASON_MAX,
  proSeedErrorMessage,
  seedInputReady,
  seedVerifiedPro,
} from "../../../services/proSeed";
import { revokePro } from "../../../services/proBlessing";
import { useNotifications } from "../../../context/NotificationContext";
import { useAdminUserLookup } from "../useAdminUserLookup";
import { errorMessage } from "../utils";
import { UserLookupForm } from "./UserLookupForm";
import { ConfirmButton } from "./ConfirmButton";
import { AdminTextField } from "./AdminFormFields";

/**
 * Founder seeding + revoke of Verified Pro. Blessing by another pro (the
 * proBlessing callable) is the normal path; this tab seeds the first pros.
 * Verified Pro grant/revoke. Verification is human-approved, audited and
 * revocable (ECONOMY.md), so both directions are two-step and both refetch
 * the profile afterwards rather than flipping a local flag — the badge the
 * operator sees is always the one Firestore actually holds.
 *
 * Seeding goes through the `proSeed` callable and needs a reason plus
 * evidence (company + https link); each seed writes an append-only
 * `proAudit` row server-side (security audit 2026-10-21).
 */
export function VerifyProPanel() {
  const lookup = useAdminUserLookup();
  const { notify } = useNotifications();
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");

  const target = lookup.target;
  const isPro = target?.isVerifiedPro === true;

  const run = async (grant: boolean): Promise<void> => {
    if (!target) return;
    setActing(true);
    try {
      if (grant) {
        await seedVerifiedPro(target.uid, reason, { company, url });
        setReason("");
        setCompany("");
        setUrl("");
      } else {
        // Server path: also marks accepted blessings revoked (lineage stays honest).
        await revokePro(target.uid);
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
        message: grant ? proSeedErrorMessage(err) : errorMessage(err),
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <section aria-label="Seed Pro">
      <p
        role="note"
        className="mb-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-body text-xs text-amber-100"
      >
        Founder seeding and revoke only. Pros normally turn pro when another verified pro blesses them. Grant here only
        to seed the first pros. Every grant needs a reason and evidence and is logged with your uid.
      </p>
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
            <>
              <AdminTextField
                label="Reason"
                value={reason}
                onChange={setReason}
                placeholder="Why they are a real pro"
                maxLength={SEED_REASON_MAX}
                note={`${reason.length}/${SEED_REASON_MAX}`}
              />
              <AdminTextField
                label="Evidence company"
                value={company}
                onChange={setCompany}
                placeholder="Board, shoe or video company"
                maxLength={SEED_COMPANY_MAX}
              />
              <AdminTextField
                label="Evidence link"
                value={url}
                onChange={setUrl}
                placeholder="https://… team page, pro model or video part"
                maxLength={500}
              />
              <ConfirmButton
                disabled={!seedInputReady(reason, { company, url })}
                label="Grant"
                question={`Grant Verified Pro to @${target.username}?`}
                confirmLabel="Grant"
                loading={acting}
                onConfirm={() => void run(true)}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
