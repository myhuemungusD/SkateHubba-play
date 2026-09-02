import { useState } from "react";
import type { InstallStatus } from "../hooks/useInstallPrompt";
import type { InstallOutcome } from "../lib/installPrompt";
import { logger } from "../services/logger";

const CARD = "block w-full text-left p-4 rounded-2xl glass-card";
const INTERACTIVE =
  " hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 disabled:cursor-not-allowed";
const TITLE = "font-display text-sm text-white tracking-wide";
const DESC = "font-body text-xs text-faint mt-1";

/**
 * Settings → "Install app" row. Purely presentational: the platform decision
 * is made by `useInstallPrompt` and passed in as `status`, which keeps every
 * branch testable without touching `navigator`.
 *
 * `native` is excluded on purpose — Settings hides the whole section inside
 * the Capacitor shell, where there is nothing to install.
 */
export function InstallAppCard({
  status,
  onInstall,
}: {
  status: Exclude<InstallStatus, "native">;
  onInstall: () => Promise<InstallOutcome>;
}) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await onInstall();
    } catch (err) {
      // The browser refused to open its dialog (e.g. the parked event went
      // stale). The store already dropped to "none", so the card falls back
      // to the manual instructions on the next render.
      logger.warn("install_prompt_failed", { error: String(err) });
    } finally {
      setInstalling(false);
    }
  };

  if (status === "installed") {
    return (
      <div className={CARD}>
        <p className={TITLE}>Installed on this device</p>
        <p className={DESC}>Launch SkateHubba from your home screen for full-screen play.</p>
      </div>
    );
  }

  if (status === "ios") {
    return (
      <div className={CARD}>
        <p className={TITLE}>Add to Home Screen</p>
        <p className={DESC}>
          Open skatehubba.com in Safari, tap the Share button, then choose &ldquo;Add to Home Screen&rdquo;. SkateHubba
          opens full-screen like a native app.
        </p>
      </div>
    );
  }

  if (status === "prompt") {
    return (
      <button
        type="button"
        onClick={handleInstall}
        disabled={installing}
        aria-busy={installing}
        className={CARD + INTERACTIVE}
      >
        <p className={TITLE}>Install SkateHubba</p>
        <p className={DESC}>
          {installing
            ? "Confirm in your browser’s install dialog."
            : "Add it to your home screen — full-screen, no browser bar, one tap to play."}
        </p>
      </button>
    );
  }

  return (
    <div className={CARD}>
      <p className={TITLE}>Install SkateHubba</p>
      <p className={DESC}>
        Open your browser&apos;s menu and choose &ldquo;Install app&rdquo; or &ldquo;Add to Home Screen&rdquo;.
      </p>
    </div>
  );
}
