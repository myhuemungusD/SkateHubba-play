import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { Spinner } from "../components/ui/Spinner";
import { BootLanding } from "./BootLanding";
import { afterLandingPainted, isBootShellActive, subscribeBootShell } from "./landingBoot";

export type AppLoader = () => Promise<{ default: ComponentType }>;

/**
 * Top-level shell. Loads the full App chunk and renders it once available.
 *
 * - boot=true (signed-out visitor on `/`, `/auth`, or `/feed`): paint
 *   <BootLanding> first and only start fetching App once that shell has
 *   painted, so App's JS (Firebase et al.) never competes with LCP.
 *   Once App is mounted the boot landing stays on screen (App drives it via
 *   the shell bridge) until App releases it, so the visitor's in-page state
 *   survives the handoff.
 * - boot=false: same spinner as before while App loads; the import starts
 *   immediately.
 */
export function Root({ boot, loadApp }: { boot: boolean; loadApp: AppLoader }) {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const shellActive = useSyncExternalStore(subscribeBootShell, isBootShellActive);

  useEffect(() => {
    let cancelled = false;
    const start = () => {
      loadApp()
        .then((mod) => {
          if (!cancelled) setApp(() => mod.default);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    if (boot) afterLandingPainted(start);
    else start();
    return () => {
      cancelled = true;
    };
  }, [boot, loadApp]);

  if (App) {
    return (
      <>
        {boot && shellActive && <BootLanding />}
        <App />
      </>
    );
  }
  if (failed) {
    // Typically a stale tab after a deploy (old chunk hashes are gone).
    return (
      <div role="alert" className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-body text-sm text-muted">SkateHubba couldn&apos;t finish loading.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-6 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider"
        >
          Reload
        </button>
      </div>
    );
  }
  return boot ? <BootLanding /> : <Spinner />;
}
