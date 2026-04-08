import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider, useAuthContext } from "./context/AuthContext";
import { NavigationProvider, useNavigationContext } from "./context/NavigationContext";
import { GameProvider, useGameContext } from "./context/GameContext";
import { NotificationProvider } from "./context/NotificationContext";
import { getUidByUsername } from "./services/users";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui/Spinner";
import { ToastContainer } from "./components/ToastContainer";
import { GameNotificationWatcher } from "./components/GameNotificationWatcher";
import { OfflineBanner } from "./components/OfflineBanner";
import { firebaseReady } from "./firebase";
import { ConsentBanner } from "./components/ConsentBanner";
import { Landing } from "./screens/Landing";
import { AuthScreen } from "./screens/AuthScreen";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Lobby } from "./screens/Lobby";
import { ChallengeScreen } from "./screens/ChallengeScreen";
import { GamePlayScreen } from "./screens/GamePlayScreen";
import { GameOverScreen } from "./screens/GameOverScreen";
import { PlayerProfileScreen } from "./screens/PlayerProfileScreen";
import { PrivacyPolicy } from "./screens/PrivacyPolicy";
import { TermsOfService } from "./screens/TermsOfService";
import { DataDeletion } from "./screens/DataDeletion";
import { MapScreen } from "./screens/MapScreen";
import { SpotDetailScreen } from "./screens/SpotDetailScreen";
import { AgeGate } from "./screens/AgeGate";
import { NotFound } from "./screens/NotFound";

function ScreenErrorFallback({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
      <h1 className="font-display text-3xl text-white mb-2">Something went wrong</h1>
      <p className="font-body text-sm text-[#888] mb-6 text-center max-w-sm">
        This screen crashed. Your game data is safe.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        Back to Lobby
      </button>
    </div>
  );
}

function FirebaseMissing() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
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
  const auth = useAuthContext();

  if (auth.loading) return <Spinner />;

  return (
    <NotificationProvider uid={auth.user?.uid ?? null}>
      <OfflineBanner />
      <GameNotificationWatcher />
      <AppRoutes />
      <ToastContainer />
    </NotificationProvider>
  );
}

/** Wrapper that extracts :uid from URL params and renders PlayerProfileScreen. */
function PlayerProfileRoute({
  currentUserProfile,
  ownGames,
  onOpenGame,
  onBack,
  onChallenge,
  onViewPlayer,
}: {
  currentUserProfile: import("./services/users").UserProfile;
  ownGames: import("./services/games").GameDoc[];
  onOpenGame: (g: import("./services/games").GameDoc) => void;
  onBack: () => void;
  onChallenge: (uid: string, username: string) => void;
  onViewPlayer: (uid: string) => void;
}) {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <Navigate to="/lobby" replace />;

  const isOwn = uid === currentUserProfile.uid;

  return (
    <PlayerProfileScreen
      key={uid}
      viewedUid={uid}
      currentUserProfile={currentUserProfile}
      ownGames={ownGames}
      isOwnProfile={isOwn}
      onOpenGame={onOpenGame}
      onBack={onBack}
      onChallenge={isOwn ? undefined : onChallenge}
      onViewPlayer={onViewPlayer}
    />
  );
}

/** Wrapper that extracts :spotId from URL params and renders SpotDetailScreen. */
function SpotDetailRoute({
  currentUserProfile,
  onBack,
  onOpenGame,
  onViewPlayer,
}: {
  currentUserProfile: import("./services/users").UserProfile;
  onBack: () => void;
  onOpenGame: (g: import("./services/games").GameDoc) => void;
  onViewPlayer: (uid: string) => void;
}) {
  const { spotId } = useParams<{ spotId: string }>();
  if (!spotId) return <Navigate to="/map" replace />;

  return (
    <SpotDetailScreen
      key={spotId}
      spotId={spotId}
      profile={currentUserProfile}
      onBack={onBack}
      onOpenGame={onOpenGame}
      onViewPlayer={onViewPlayer}
    />
  );
}

function AppRoutes() {
  const auth = useAuthContext();
  const nav = useNavigationContext();
  const game = useGameContext();
  const [challengeTarget, setChallengeTarget] = useState("");
  const directChallenge = useCallback(
    async (username: string) => {
      const normalized = username.toLowerCase().trim();
      try {
        const uid = await getUidByUsername(normalized);
        if (!uid) {
          setChallengeTarget(normalized);
          nav.setScreen("challenge");
          return;
        }
        await game.startChallenge(uid, normalized);
      } catch {
        setChallengeTarget(normalized);
        nav.setScreen("challenge");
      }
    },
    [nav, game],
  );

  // Deep-link into a game when a push notification is tapped (service worker postMessage)
  useEffect(() => {
    const handler = (e: Event) => {
      const gameId = (e as CustomEvent).detail?.gameId;
      if (!gameId || !game.games) return;
      const found = game.games.find((g) => g.id === gameId);
      if (found) game.openGame(found);
    };
    window.addEventListener("skatehubba:open-game", handler);
    return () => window.removeEventListener("skatehubba:open-game", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-subscribe when games list or openGame changes
  }, [game.games, game.openGame]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-brand-orange focus:text-white focus:font-display focus:tracking-wider focus:outline-none"
      >
        Skip to main content
      </a>
      <main id="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <Landing
                onGo={(m) => {
                  if (m === "signup") {
                    nav.setAuthMode("signup");
                    nav.setScreen("agegate");
                  } else {
                    nav.setAuthMode(m);
                    nav.setScreen("auth");
                  }
                }}
                onGoogle={auth.handleGoogleSignIn}
                googleLoading={auth.googleLoading}
                onNav={nav.setScreen}
              />
            }
          />

          <Route
            path="/age-gate"
            element={
              <AgeGate
                onVerified={(dob, parentalConsent) => {
                  nav.setAgeGateResult(dob, parentalConsent);
                  nav.setScreen("auth");
                }}
                onBack={() => nav.setScreen("landing")}
                onNav={nav.setScreen}
              />
            }
          />

          <Route
            path="/auth"
            element={
              <AuthScreen
                key={nav.authMode}
                mode={nav.authMode}
                onDone={() => {
                  /* auth state change triggers auto-navigate */
                }}
                onToggle={() => {
                  auth.setGoogleError("");
                  if (nav.authMode === "signin") {
                    // Switching to signup — require age gate if not already completed
                    if (nav.ageGateDob) {
                      nav.setAuthMode("signup");
                    } else {
                      nav.setAuthMode("signup");
                      nav.setScreen("agegate");
                    }
                    return;
                  }
                  nav.setAuthMode("signin");
                }}
                onGoogle={auth.handleGoogleSignIn}
                googleLoading={auth.googleLoading}
                googleError={auth.googleError}
                onGoogleErrorDismiss={() => auth.setGoogleError("")}
              />
            }
          />

          <Route
            path="/profile"
            element={
              auth.user ? (
                <ProfileSetup
                  uid={auth.user.uid}
                  emailVerified={auth.user.emailVerified}
                  displayName={auth.user.displayName}
                  dob={nav.ageGateDob}
                  parentalConsent={nav.ageGateParentalConsent}
                  onDone={async (p) => {
                    auth.setActiveProfile(p);
                    nav.setScreen("lobby");
                    await auth.refreshProfile();
                  }}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/lobby"
            element={
              auth.activeProfile ? (
                <Lobby
                  profile={auth.activeProfile}
                  games={game.games}
                  user={auth.user}
                  onChallenge={() => {
                    setChallengeTarget("");
                    nav.setScreen("challenge");
                  }}
                  onChallengeUser={(username: string) => {
                    directChallenge(username);
                  }}
                  onOpenGame={game.openGame}
                  onSignOut={auth.handleSignOut}
                  onDeleteAccount={auth.handleDeleteAccount}
                  onViewRecord={() => nav.setScreen("record")}
                  hasMoreGames={game.hasMoreGames}
                  onLoadMore={game.loadMoreGames}
                  gamesLoading={game.gamesLoading}
                  onViewPlayer={nav.navigateToPlayer}
                  onViewMap={() => nav.setScreen("map")}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/challenge"
            element={
              auth.activeProfile && auth.user?.emailVerified ? (
                <ChallengeScreen
                  profile={auth.activeProfile}
                  onSend={game.startChallenge}
                  onBack={() => nav.setScreen("lobby")}
                  initialOpponent={challengeTarget}
                  onViewPlayer={nav.navigateToPlayer}
                />
              ) : (
                <Navigate to="/lobby" replace />
              )
            }
          />

          <Route
            path="/game"
            element={
              game.activeGame && auth.activeProfile ? (
                <ErrorBoundary
                  fallback={
                    <ScreenErrorFallback
                      onBack={() => {
                        game.setActiveGame(null);
                        nav.setScreen("lobby");
                      }}
                    />
                  }
                >
                  <GamePlayScreen
                    key={game.activeGame.turnNumber}
                    game={game.activeGame}
                    profile={auth.activeProfile}
                    onBack={() => {
                      game.setActiveGame(null);
                      nav.setScreen("lobby");
                    }}
                  />
                </ErrorBoundary>
              ) : (
                <Navigate to="/lobby" replace />
              )
            }
          />

          <Route
            path="/gameover"
            element={
              game.activeGame && auth.activeProfile && auth.user ? (
                <ErrorBoundary
                  fallback={
                    <ScreenErrorFallback
                      onBack={() => {
                        game.setActiveGame(null);
                        nav.setScreen("lobby");
                      }}
                    />
                  }
                >
                  <GameOverScreen
                    game={game.activeGame}
                    profile={auth.activeProfile}
                    onRematch={
                      auth.user.emailVerified
                        ? async (): Promise<void> => {
                            const opponentUid =
                              game.activeGame!.player1Uid === auth.user!.uid
                                ? game.activeGame!.player2Uid
                                : game.activeGame!.player1Uid;
                            const opponentName =
                              game.activeGame!.player1Uid === auth.user!.uid
                                ? game.activeGame!.player2Username
                                : game.activeGame!.player1Username;
                            await game.startChallenge(opponentUid, opponentName);
                          }
                        : undefined
                    }
                    onBack={() => {
                      game.setActiveGame(null);
                      nav.setScreen("lobby");
                    }}
                    onViewPlayer={nav.navigateToPlayer}
                  />
                </ErrorBoundary>
              ) : (
                <Navigate to="/lobby" replace />
              )
            }
          />

          <Route
            path="/record"
            element={
              auth.activeProfile ? (
                <PlayerProfileScreen
                  viewedUid={auth.activeProfile.uid}
                  currentUserProfile={auth.activeProfile}
                  ownGames={game.games}
                  isOwnProfile={true}
                  onOpenGame={game.openGame}
                  onBack={() => nav.setScreen("lobby")}
                  onViewPlayer={nav.navigateToPlayer}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/player/:uid"
            element={
              auth.activeProfile ? (
                <PlayerProfileRoute
                  currentUserProfile={auth.activeProfile}
                  ownGames={game.games}
                  onOpenGame={game.openGame}
                  onBack={() => nav.setScreen("lobby")}
                  onChallenge={(_uid, username) => directChallenge(username)}
                  onViewPlayer={nav.navigateToPlayer}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/map"
            element={
              auth.activeProfile ? (
                <MapScreen
                  profile={auth.activeProfile}
                  onBack={() => nav.setScreen("lobby")}
                  onViewSpot={nav.navigateToSpot}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/spot/:spotId"
            element={
              auth.activeProfile ? (
                <SpotDetailRoute
                  currentUserProfile={auth.activeProfile}
                  onBack={() => nav.setScreen("map")}
                  onOpenGame={game.openGame}
                  onViewPlayer={nav.navigateToPlayer}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/privacy"
            element={<PrivacyPolicy onBack={() => nav.setScreen("landing")} onNav={nav.setScreen} />}
          />

          <Route path="/terms" element={<TermsOfService onBack={() => nav.setScreen("landing")} />} />

          <Route
            path="/data-deletion"
            element={<DataDeletion onBack={() => nav.setScreen(auth.user ? "lobby" : "landing")} />}
          />

          <Route path="/404" element={<NotFound onBack={() => nav.setScreen(auth.user ? "lobby" : "landing")} />} />

          {/* Catch-all: redirect unknown paths to 404 */}
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </main>

      <ConsentBanner onNav={nav.setScreen} />
      <Analytics />
    </>
  );
}

function AppInner() {
  if (!firebaseReady) return <FirebaseMissing />;

  return (
    <AuthProvider>
      <NavigationProvider>
        <GameProvider>
          <AppScreens />
        </GameProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
