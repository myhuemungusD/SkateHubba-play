import { useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { Landing } from "../screens/Landing";
import { Spinner } from "../components/ui/Spinner";
import { BootAuth } from "./BootAuth";
import { BootFeed } from "./BootFeed";
import {
  getLandingBridge,
  hasBootAppleSignIn,
  hasBootGoogleSignIn,
  requestBootAppleSignIn,
  requestBootGoogleSignIn,
  setBootAuthMode,
  subscribeBootShell,
} from "./landingBoot";

const LEGAL_PATHS = { privacy: "/privacy", terms: "/terms", datadeletion: "/data-deletion" } as const;

/**
 * The landing page painted before the full app has loaded (see landingBoot.ts).
 * Pure presentation: no Firebase, no contexts. Until App has loaded,
 * interactions are routed or recorded as intents for App to pick up; once App
 * is mounted it publishes its real handlers through the shell bridge and this
 * same <Landing> instance keeps rendering with them (no remount). Anything
 * `/auth` and `/feed` paint their own shells (the auth card, the feed
 * poster). Anything else shows the same spinner App would while it loads.
 */
export function BootLanding() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [googlePending, setGooglePending] = useState(hasBootGoogleSignIn);
  const [applePending, setApplePending] = useState(hasBootAppleSignIn);
  const bridge = useSyncExternalStore(subscribeBootShell, getLandingBridge);

  if (pathname === "/auth") return <BootAuth />;
  if (pathname === "/feed") return <BootFeed />;
  if (pathname !== "/") return <Spinner />;

  if (bridge) return <Landing {...bridge} />;

  return (
    <Landing
      onGo={(mode) => {
        setBootAuthMode(mode);
        navigate("/auth");
      }}
      onGoogle={() => {
        requestBootGoogleSignIn();
        setGooglePending(true);
      }}
      googleLoading={googlePending}
      onApple={() => {
        requestBootAppleSignIn();
        setApplePending(true);
      }}
      appleLoading={applePending}
      onNav={(screen) => navigate(LEGAL_PATHS[screen])}
    />
  );
}
