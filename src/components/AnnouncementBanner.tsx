import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import {
  dismissAnnouncement,
  dismissedAnnouncements,
  getActiveAnnouncement,
  type Announcement,
} from "../services/adminInsights";
import { fetchIsFeatureTester } from "../services/featureTesters";
import { isNativeShell } from "../lib/featureFlags";

/** In-app banner for the newest live announcement this player is in the audience for. */
export function AnnouncementBanner({ uid, isPro }: { uid: string; isPro: boolean }) {
  const [item, setItem] = useState<Announcement | null>(null);
  useEffect(() => {
    let live = true;
    // Store builds never act on the runtime tester list (App Store 2.3.1), so
    // native skips the read and only sees non-tester announcements.
    (isNativeShell() ? Promise.resolve(false) : fetchIsFeatureTester(uid))
      .then((isTester) => getActiveAnnouncement({ isPro, isTester }))
      .then(
        (a) => {
          if (live && a && !dismissedAnnouncements().includes(a.id)) setItem(a);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [uid, isPro]);
  if (!item) return null;
  return (
    <div
      role="status"
      data-testid="announcement-banner"
      className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-start gap-2 rounded-2xl border border-brand-orange/40 bg-surface p-3 shadow-card"
    >
      <Megaphone size={16} className="mt-0.5 shrink-0 text-brand-orange" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm tracking-wider text-white">{item.title}</p>
        <p className="font-body text-xs text-white/80">{item.body}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss announcement"
        className="shrink-0 p-1 text-white/60 hover:text-white"
        onClick={() => {
          dismissAnnouncement(item.id);
          setItem(null);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
