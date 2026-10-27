import { useCallback, useState } from "react";
import { trackEvent } from "../../services/analytics";
import { copyText, isShareAvailable, shareUrl } from "../../services/nativeBridge";
import { hashUid } from "../../utils/pii";
import { publicProfileUrl } from "../../lib/clipShare";

/**
 * "Share my profile". Goes through the native bridge so the iPhone/Android
 * apps open the OS share sheet (Android's WebView has no Web Share), and
 * builds the link from VITE_APP_URL so the app shell never shares its own
 * capacitor://localhost origin. `/player/:uid` is the public profile route.
 * Falls back to copying the link; `copied` drives the "LINK COPIED" label.
 */
export function useShareProfile(viewerUid: string, username: string | undefined) {
  const [copied, setCopied] = useState(false);
  const share = useCallback(async () => {
    const url = publicProfileUrl(viewerUid);
    trackEvent("profile_share_my_profile_tapped", { uid: hashUid(viewerUid) });
    try {
      if (isShareAvailable()) {
        await shareUrl({ title: `@${username} on SkateHubba`, text: "Catch my SkateHubba profile", url });
        return;
      }
      // No share sheet: copy the bare link (shareText's own clipboard
      // fallback copies the message text, which has no link in it).
      await copyText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // User cancelled the sheet, or no share/clipboard at all. Telemetry
      // already fired, so a silent fail is visible on the dashboard.
    }
  }, [viewerUid, username]);
  return { share, copied };
}
