import { useState, useCallback, useEffect, lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
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
import { BottomNav } from "./components/BottomNav";
import { useBlockedUsers } from "./hooks/useBlockedUsers";
import { firebaseReady } from "./firebase";
import { ConsentBanner } from "./components/ConsentBanner";
import { useAnalyticsConsent } from "./hooks/useAnalyticsConsent";
// Eager: first-paint / onboarding path (Landing, AgeGate, AuthScreen, ProfileSetup)
// plus Lobby since it's the primary destination for returning authed users.
import { Landing } from "./screens/Landing";
import { AuthScreen } from "./screens/AuthScreen";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Lobby } from "./screens/Lobby";
// AgeGate stays eager — it's in the signup path and the first-paint bundle
// already carries the auth flow, so a split here would just add a spinner
// flash on an already-short critical route.
import { AgeGate } from "./screens/AgeGate";
// Lazy: non-critical / heavy secondary screens — code-split into separate
// chunks so the first-paint bundle doesn't pay for Mapbox (MapPage +
// SpotDetailPage pull ~400KB of tiles/SDK), the gameplay surfaces only an
// authed user needs, the static legal pages, or the Settings screen. Suspense
// falls back to the same full-screen Spinner we use during auth hydration so
// the transition feels uniform.
const ChallengeScreen = lazy(() => import("./screens/ChallengeScreen").then((m) => ({ default: m.ChallengeScreen })));
const GamePlayScreen = lazy(() => import("./screens/GamePlayScreen").then((m) => ({ default: m.GamePlayScreen })));
const GameOverScreen = lazy(() => import("./screens/GameOverScreen").then((m) => ({ default: m.GameOverScreen })));
const PlayerProfileScreen = lazy(() =>
  import("./screens/PlayerProfileScreen").then((m) => ({ default: m.PlayerProfileScreen })),
);
const PrivacyPolicy = lazy(() => import("./screens/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import("./screens/TermsOfService").then((m) => ({ default: m.TermsOfService })));
const DataDeletion = lazy(() => import("./screens/DataDeletion").then((m) => ({ default: m.DataDeletion })));
const NotFound = lazy(() => import("./screens/NotFound").then((m) => ({ default: m.NotFound })));
const MapPage = lazy(() => import("./screens/MapPage").then((m) => ({ default: m.MapPage })));
const SpotDetailPage = lazy(() => import("./screens/SpotDetailPage").then((m) => ({ default: m.SpotDetailPage })));
const Settings = lazy(() => import("./screens/Settings").then((m) => ({ default: m.Settings })));

function ScreenErrorFallback({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-background">
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
      <h1 className="font-display text-3xl text-white mb-2">Something went wrong</h1>
      <p className="font-body text-sm text-muted mb-6 text-center max-w-sm">
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
      <p className="font-body text-base text-muted max-w-sm mt-4 leading-relaxed">
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
    <>
      <OfflineBanner />
      <GameNotificationWatcher />
      <AppRoutes />
      <ToastContainer />
    </>
  );
}

/**
 * Bridges auth state into NotificationProvider so GameProvider (which lives
 * below notifications in the tree) can fire toasts — e.g. "Challenge sent to
 * @X". Keeps the existing uid-scoped persistence in NotificationProvider
 * intact; we just read auth once here and hand it down.
 */
function NotificationAuthBridge({ children }: { children: ReactNode }) {
  const auth = useAuthContext();
  return <NotificationProvider uid={auth.user?.uid ?? null}>{children}</NotificationProvider>;
}

/** Wrapper that extracts :uid from URL params and renders PlayerProfileScreen. */
function PlayerProfileRoute({
  currentUserProfile,
  ownGames,
  onOpenGame,
  onBack,
  onChallenge,
  onViewPlayer,
  blockedUids,
}: {
  currentUserProfile: import("./services/users").UserProfile;
  ownGames: import("./services/games").GameDoc[];
  onOpenGame: (g: import("./services/games").GameDoc) => void;
  onBack: () => void;
  onChallenge: (uid: string, username: string) => void;
  onViewPlayer: (uid: string) => void;
  blockedUids: Set<string>;
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
      blockedUids={blockedUids}
    />
  );
}

function AppRoutes() {
  const auth = useAuthContext();
  const nav = useNavigationContext();
  const navigate = useNavigate();
  const game = useGameContext();
  const blockedUids = useBlockedUsers(auth.user?.uid ?? "");
  const analyticsAllowed = useAnalyticsConsent();
  const [challengeTarget, setChallengeTarget] = useState("");
  const directChallenge = useCallback(
    async (username: string) => {
      if (!auth.user?.emailVerified) {
        nav.setScreen("lobby");
        return;
      }
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
    [auth.user?.emailVerified, nav, game],
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
        <Suspense fallback={<Spinner />}>
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
                      nav.setAuthMode("signup");
                      if (!nav.ageGateDob) {
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
                    onDownloadData={auth.handleDownloadData}
                    onViewRecord={() => nav.setScreen("record")}
                    onOpenSettings={() => navigate("/settings")}
                    hasMoreGames={game.hasMoreGames}
                    onLoadMore={game.loadMoreGames}
                    gamesLoading={game.gamesLoading}
                    onViewPlayer={nav.navigateToPlayer}
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
                    blockedUids={blockedUids}
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
                              if (!game.activeGame || !auth.user) return;
                              const opponentUid =
                                game.activeGame.player1Uid === auth.user.uid
                                  ? game.activeGame.player2Uid
                                  : game.activeGame.player1Uid;
                              const opponentName =
                                game.activeGame.player1Uid === auth.user.uid
                                  ? game.activeGame.player2Username
                                  : game.activeGame.player1Username;
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
                    blockedUids={blockedUids}
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

            <Route
              path="/settings"
              element={
                auth.activeProfile ? (
                  <Settings profile={auth.activeProfile} onBack={() => nav.setScreen("lobby")} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />

            <Route path="/map" element={<MapPage />} />
            <Route path="/spots/:id" element={<SpotDetailPage />} />

            {/* /feed used to live as its own route + tab — it's now embedded in
              the lobby. Redirect lingering deep-links so old shares still land. */}
            <Route path="/feed" element={<Navigate to="/lobby" replace />} />

            <Route path="/404" element={<NotFound onBack={() => nav.setScreen(auth.user ? "lobby" : "landing")} />} />

            {/* Catch-all: redirect unknown paths to 404 */}
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </Suspense>
      </main>

      <BottomNav />
      <ConsentBanner onNav={nav.setScreen} />
      {analyticsAllowed && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </>
  );
}

function AppInner() {
  if (!firebaseReady) return <FirebaseMissing />;

  return (
    <AuthProvider>
      <NavigationProvider>
        <NotificationAuthBridge>
          <GameProvider>
            <AppScreens />
          </GameProvider>
        </NotificationAuthBridge>
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
