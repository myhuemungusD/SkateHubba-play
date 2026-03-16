import { Analytics } from "@vercel/analytics/react";
import { useGameContext, GameProvider } from "./context/GameContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui/Spinner";
import { firebaseReady } from "./firebase";
import { BG } from "./utils/helpers";
import { Landing } from "./screens/Landing";
import { AuthScreen } from "./screens/AuthScreen";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Lobby } from "./screens/Lobby";
import { ChallengeScreen } from "./screens/ChallengeScreen";
import { GamePlayScreen } from "./screens/GamePlayScreen";
import { GameOverScreen } from "./screens/GameOverScreen";
import { PrivacyPolicy } from "./screens/PrivacyPolicy";
import { TermsOfService } from "./screens/TermsOfService";
import { NotFound } from "./screens/NotFound";
import { ConsentBanner } from "./components/ConsentBanner";

function FirebaseMissing() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center" style={{ background: BG }}>
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-2">SKATEHUBBA™</span>
      <h2 className="font-display text-3xl text-white mt-4">Setup Required</h2>
      <p className="font-body text-base text-[#888] max-w-sm mt-4 leading-relaxed">
        Firebase environment variables are missing. Add <code className="text-brand-orange">VITE_FIREBASE_*</code>{" "}
        variables in your Vercel Dashboard under Project Settings → Environment Variables.
      </p>
    </div>
  );
}

function AppScreens() {
  const ctx = useGameContext();

  if (ctx.loading) return <Spinner />;

  return (
    <>
      {ctx.screen === "landing" && (
        <Landing
          onGo={(m) => {
            ctx.setAuthMode(m);
            ctx.setScreen("auth");
          }}
          onGoogle={ctx.handleGoogleSignIn}
          googleLoading={ctx.googleLoading}
          onNav={ctx.setScreen}
        />
      )}

      {ctx.screen === "auth" && (
        <AuthScreen
          key={ctx.authMode}
          mode={ctx.authMode}
          onDone={() => {
            /* auth state change triggers auto-navigate */
          }}
          onToggle={() => {
            ctx.setGoogleError("");
            ctx.setAuthMode(ctx.authMode === "signup" ? "signin" : "signup");
          }}
          onGoogle={ctx.handleGoogleSignIn}
          googleLoading={ctx.googleLoading}
          googleError={ctx.googleError}
        />
      )}

      {ctx.screen === "profile" && ctx.user && (
        <ProfileSetup
          uid={ctx.user.uid}
          email={ctx.user.email || ""}
          emailVerified={ctx.user.emailVerified}
          displayName={ctx.user.displayName}
          onDone={async (p) => {
            ctx.setActiveProfile(p);
            ctx.setScreen("lobby");
            await ctx.refreshProfile();
          }}
        />
      )}

      {ctx.screen === "lobby" && ctx.activeProfile && (
        <Lobby
          profile={ctx.activeProfile}
          games={ctx.games}
          user={ctx.user}
          onChallenge={() => ctx.setScreen("challenge")}
          onOpenGame={ctx.openGame}
          onSignOut={ctx.handleSignOut}
          onDeleteAccount={ctx.handleDeleteAccount}
        />
      )}

      {ctx.screen === "challenge" && ctx.activeProfile && ctx.user?.emailVerified && (
        <ChallengeScreen
          profile={ctx.activeProfile}
          onSend={ctx.startChallenge}
          onBack={() => ctx.setScreen("lobby")}
        />
      )}

      {ctx.screen === "game" && ctx.activeGame && ctx.activeProfile && (
        <GamePlayScreen
          game={ctx.activeGame}
          profile={ctx.activeProfile}
          onBack={() => {
            ctx.setActiveGame(null);
            ctx.setScreen("lobby");
          }}
        />
      )}

      {ctx.screen === "gameover" && ctx.activeGame && ctx.activeProfile && ctx.user && (
        <GameOverScreen
          game={ctx.activeGame}
          profile={ctx.activeProfile}
          onRematch={
            ctx.user.emailVerified
              ? async (): Promise<void> => {
                  const opponentUid =
                    ctx.activeGame!.player1Uid === ctx.user!.uid
                      ? ctx.activeGame!.player2Uid
                      : ctx.activeGame!.player1Uid;
                  const opponentName =
                    ctx.activeGame!.player1Uid === ctx.user!.uid
                      ? ctx.activeGame!.player2Username
                      : ctx.activeGame!.player1Username;
                  await ctx.startChallenge(opponentUid, opponentName);
                }
              : undefined
          }
          onBack={() => {
            ctx.setActiveGame(null);
            ctx.setScreen("lobby");
          }}
        />
      )}
      {ctx.screen === "privacy" && <PrivacyPolicy onBack={() => ctx.setScreen("landing")} />}

      {ctx.screen === "terms" && <TermsOfService onBack={() => ctx.setScreen("landing")} />}

      {ctx.screen === "notfound" && <NotFound onBack={() => ctx.setScreen(ctx.user ? "lobby" : "landing")} />}

      <ConsentBanner onNav={ctx.setScreen} />
      <Analytics />
    </>
  );
}

function AppInner() {
  if (!firebaseReady) return <FirebaseMissing />;

  return (
    <GameProvider>
      <AppScreens />
    </GameProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
