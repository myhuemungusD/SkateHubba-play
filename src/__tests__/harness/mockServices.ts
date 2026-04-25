/**
 * Shared mock-factory harness for smoke tests.
 *
 * vitest's `vi.mock(path, factory)` runs hoisted to the top of the file,
 * so the factory argument cannot close over live module scope. The pattern
 * here is:
 *
 *   const auth = vi.hoisted(() => createAuthServiceMocks());
 *   vi.mock("../services/auth", () => auth.module);
 *   // then interact with auth.refs.signIn.mockResolvedValueOnce(...) per test
 *
 * Each `create<Service>Mocks()` returns:
 *   - `refs`: the `vi.fn()` handles tests drive (.mockResolvedValue, etc.)
 *   - `module`: the object literal vi.mock() substitutes for the real module
 *
 * The `module` shape is a superset of what every smoke-*.test.tsx file
 * mocks today — extra members are harmless (tree-shaken by vitest when the
 * SUT doesn't import them) and mean every smoke test can use the harness
 * without losing any mock it relied on.
 */
import { vi, type Mock } from "vitest";

/* ──────────────────────────────────────────
 * useAuth hook
 * ────────────────────────────────────────── */

export interface UseAuthMocks {
  refs: { useAuth: Mock };
  module: { useAuth: () => unknown };
}

export function createUseAuthMocks(): UseAuthMocks {
  const useAuth = vi.fn();
  return {
    refs: { useAuth },
    module: { useAuth: () => useAuth() },
  };
}

/* ──────────────────────────────────────────
 * services/auth
 * ────────────────────────────────────────── */

export interface AuthServiceRefs {
  signUp: Mock;
  signIn: Mock;
  signOut: Mock;
  resetPassword: Mock;
  resendVerification: Mock;
  signInWithGoogle: Mock;
  resolveGoogleRedirect: Mock;
  deleteAccount: Mock;
}

export interface AuthServiceMocks {
  refs: AuthServiceRefs;
  module: Record<keyof AuthServiceRefs, (...args: unknown[]) => unknown>;
}

export function createAuthServiceMocks(): AuthServiceMocks {
  const refs: AuthServiceRefs = {
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    resendVerification: vi.fn(),
    signInWithGoogle: vi.fn(),
    // Default to a resolved null so AuthContext's mount effect doesn't throw.
    resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
    deleteAccount: vi.fn(),
  };
  return {
    refs,
    module: {
      signUp: (...args: unknown[]) => refs.signUp(...args),
      signIn: (...args: unknown[]) => refs.signIn(...args),
      signOut: (...args: unknown[]) => refs.signOut(...args),
      resetPassword: (...args: unknown[]) => refs.resetPassword(...args),
      resendVerification: (...args: unknown[]) => refs.resendVerification(...args),
      signInWithGoogle: (...args: unknown[]) => refs.signInWithGoogle(...args),
      resolveGoogleRedirect: (...args: unknown[]) => refs.resolveGoogleRedirect(...args),
      deleteAccount: (...args: unknown[]) => refs.deleteAccount(...args),
    },
  };
}

/* ──────────────────────────────────────────
 * services/users
 * ────────────────────────────────────────── */

export interface UsersServiceRefs {
  createProfile: Mock;
  isUsernameAvailable: Mock;
  getUidByUsername: Mock;
  deleteUserData: Mock;
  getPlayerDirectory: Mock;
  getLeaderboard: Mock;
  getUserProfile: Mock;
  getUserProfileOnAuth: Mock;
  updatePlayerStats: Mock;
}

export interface UsersServiceModule {
  createProfile: (...args: unknown[]) => unknown;
  isUsernameAvailable: (...args: unknown[]) => unknown;
  getUidByUsername: (...args: unknown[]) => unknown;
  deleteUserData: (...args: unknown[]) => unknown;
  getPlayerDirectory: (...args: unknown[]) => unknown;
  getLeaderboard: (...args: unknown[]) => unknown;
  getUserProfile: (...args: unknown[]) => unknown;
  getUserProfileOnAuth: (...args: unknown[]) => unknown;
  updatePlayerStats: (...args: unknown[]) => unknown;
  // Validation constants imported by ProfileSetup.
  USERNAME_MIN: number;
  USERNAME_MAX: number;
  USERNAME_RE: RegExp;
  PRIVATE_PROFILE_DOC_ID: string;
  // Real class so `err instanceof AgeVerificationRequiredError` still works.
  AgeVerificationRequiredError: typeof AgeVerificationRequiredErrorStub;
}

export interface UsersServiceMocks {
  refs: UsersServiceRefs;
  module: UsersServiceModule;
}

/**
 * Stand-in for the real `AgeVerificationRequiredError`. Tests that need to
 * simulate the COPPA gate can throw an instance of this class from
 * `createProfile.mockRejectedValue(...)`; ProfileSetup uses `instanceof` to
 * route to the error banner.
 */
class AgeVerificationRequiredErrorStub extends Error {
  constructor(message = "Age verification required") {
    super(message);
    this.name = "AgeVerificationRequiredError";
  }
}

export function createUsersServiceMocks(): UsersServiceMocks {
  const refs: UsersServiceRefs = {
    createProfile: vi.fn(),
    isUsernameAvailable: vi.fn(),
    getUidByUsername: vi.fn(),
    deleteUserData: vi.fn(),
    getPlayerDirectory: vi.fn().mockResolvedValue([]),
    getLeaderboard: vi.fn().mockResolvedValue([]),
    getUserProfile: vi.fn().mockResolvedValue(null),
    getUserProfileOnAuth: vi.fn().mockResolvedValue(null),
    updatePlayerStats: vi.fn().mockResolvedValue(undefined),
  };
  return {
    refs,
    module: {
      createProfile: (...args: unknown[]) => refs.createProfile(...args),
      isUsernameAvailable: (...args: unknown[]) => refs.isUsernameAvailable(...args),
      getUidByUsername: (...args: unknown[]) => refs.getUidByUsername(...args),
      deleteUserData: (...args: unknown[]) => refs.deleteUserData(...args),
      getPlayerDirectory: (...args: unknown[]) => refs.getPlayerDirectory(...args),
      getLeaderboard: (...args: unknown[]) => refs.getLeaderboard(...args),
      getUserProfile: (...args: unknown[]) => refs.getUserProfile(...args),
      getUserProfileOnAuth: (...args: unknown[]) => refs.getUserProfileOnAuth(...args),
      updatePlayerStats: (...args: unknown[]) => refs.updatePlayerStats(...args),
      USERNAME_MIN: 3,
      USERNAME_MAX: 20,
      USERNAME_RE: /^[a-z0-9_]+$/,
      PRIVATE_PROFILE_DOC_ID: "profile",
      AgeVerificationRequiredError: AgeVerificationRequiredErrorStub,
    },
  };
}

/* ──────────────────────────────────────────
 * services/userData
 * ────────────────────────────────────────── */

export interface UserDataServiceRefs {
  exportUserData: Mock;
  serializeUserData: Mock;
  userDataFilename: Mock;
}

export interface UserDataServiceMocks {
  refs: UserDataServiceRefs;
  module: Record<keyof UserDataServiceRefs, (...args: unknown[]) => unknown>;
}

export function createUserDataServiceMocks(): UserDataServiceMocks {
  const refs: UserDataServiceRefs = {
    exportUserData: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      exportedAt: "2026-04-15T00:00:00.000Z",
      capped: false,
      subject: { uid: "u1", username: "sk8r" },
      profile: null,
      usernameReservation: null,
      games: [],
      clips: [],
      clipVotes: [],
      spots: [],
      notifications: [],
      nudges: [],
      blockedUsers: [],
      reports: [],
    }),
    serializeUserData: vi.fn(() => "{}"),
    userDataFilename: vi.fn(() => "export.json"),
  };
  return {
    refs,
    module: {
      exportUserData: (...args: unknown[]) => refs.exportUserData(...args),
      serializeUserData: (...args: unknown[]) => refs.serializeUserData(...args),
      userDataFilename: (...args: unknown[]) => refs.userDataFilename(...args),
    },
  };
}

/* ──────────────────────────────────────────
 * services/games
 * ────────────────────────────────────────── */

export interface GamesServiceRefs {
  createGame: Mock;
  setTrick: Mock;
  failSetTrick: Mock;
  submitMatchAttempt: Mock;
  forfeitExpiredTurn: Mock;
  subscribeToMyGames: Mock;
  subscribeToGame: Mock;
  resolveDispute: Mock;
  callBSOnSetTrick: Mock;
  judgeRuleSetTrick: Mock;
  acceptJudgeInvite: Mock;
  declineJudgeInvite: Mock;
}

export interface GamesServiceModule {
  createGame: (...args: unknown[]) => unknown;
  setTrick: (...args: unknown[]) => unknown;
  failSetTrick: (...args: unknown[]) => unknown;
  submitMatchAttempt: (...args: unknown[]) => unknown;
  forfeitExpiredTurn: (...args: unknown[]) => unknown;
  subscribeToMyGames: (...args: unknown[]) => unknown;
  subscribeToGame: (...args: unknown[]) => unknown;
  resolveDispute: (...args: unknown[]) => unknown;
  callBSOnSetTrick: (...args: unknown[]) => unknown;
  judgeRuleSetTrick: (...args: unknown[]) => unknown;
  acceptJudgeInvite: (...args: unknown[]) => unknown;
  declineJudgeInvite: (...args: unknown[]) => unknown;
  isJudgeActive: (game: { judgeId?: string | null; judgeStatus?: string | null }) => boolean;
  timestampFromMillis: (ms: number) => { toMillis: () => number };
}

export interface GamesServiceMocks {
  refs: GamesServiceRefs;
  module: GamesServiceModule;
}

export function createGamesServiceMocks(): GamesServiceMocks {
  const refs: GamesServiceRefs = {
    createGame: vi.fn(),
    setTrick: vi.fn(),
    failSetTrick: vi.fn(),
    submitMatchAttempt: vi.fn(),
    forfeitExpiredTurn: vi.fn(),
    subscribeToMyGames: vi.fn(() => vi.fn()),
    subscribeToGame: vi.fn(() => vi.fn()),
    resolveDispute: vi.fn().mockResolvedValue(undefined),
    callBSOnSetTrick: vi.fn().mockResolvedValue(undefined),
    judgeRuleSetTrick: vi.fn().mockResolvedValue(undefined),
    acceptJudgeInvite: vi.fn().mockResolvedValue(undefined),
    declineJudgeInvite: vi.fn().mockResolvedValue(undefined),
  };
  return {
    refs,
    module: {
      createGame: (...args: unknown[]) => refs.createGame(...args),
      setTrick: (...args: unknown[]) => refs.setTrick(...args),
      failSetTrick: (...args: unknown[]) => refs.failSetTrick(...args),
      submitMatchAttempt: (...args: unknown[]) => refs.submitMatchAttempt(...args),
      forfeitExpiredTurn: (...args: unknown[]) => refs.forfeitExpiredTurn(...args),
      subscribeToMyGames: (...args: unknown[]) => refs.subscribeToMyGames(...args),
      subscribeToGame: (...args: unknown[]) => refs.subscribeToGame(...args),
      resolveDispute: (...args: unknown[]) => refs.resolveDispute(...args),
      callBSOnSetTrick: (...args: unknown[]) => refs.callBSOnSetTrick(...args),
      judgeRuleSetTrick: (...args: unknown[]) => refs.judgeRuleSetTrick(...args),
      acceptJudgeInvite: (...args: unknown[]) => refs.acceptJudgeInvite(...args),
      declineJudgeInvite: (...args: unknown[]) => refs.declineJudgeInvite(...args),
      isJudgeActive: (game: { judgeId?: string | null; judgeStatus?: string | null }) =>
        !!game.judgeId && game.judgeStatus === "accepted",
      timestampFromMillis: (ms: number) => ({ toMillis: () => ms }),
    },
  };
}

/* ──────────────────────────────────────────
 * services/storage
 * ────────────────────────────────────────── */

export interface StorageServiceRefs {
  uploadVideo: Mock;
}

export interface StorageServiceMocks {
  refs: StorageServiceRefs;
  module: { uploadVideo: (...args: unknown[]) => unknown };
}

export function createStorageServiceMocks(): StorageServiceMocks {
  const refs: StorageServiceRefs = { uploadVideo: vi.fn() };
  return {
    refs,
    module: { uploadVideo: (...args: unknown[]) => refs.uploadVideo(...args) },
  };
}

/* ──────────────────────────────────────────
 * services/fcm
 * ────────────────────────────────────────── */

export interface FcmServiceRefs {
  requestPushPermission: Mock;
  removeFcmToken: Mock;
  removeCurrentFcmToken: Mock;
  onForegroundMessage: Mock;
}

export interface FcmServiceMocks {
  refs: FcmServiceRefs;
  module: Record<keyof FcmServiceRefs, (...args: unknown[]) => unknown>;
}

export function createFcmServiceMocks(): FcmServiceMocks {
  const refs: FcmServiceRefs = {
    requestPushPermission: vi.fn().mockResolvedValue(null),
    removeFcmToken: vi.fn().mockResolvedValue(undefined),
    removeCurrentFcmToken: vi.fn().mockResolvedValue(undefined),
    onForegroundMessage: vi.fn(() => vi.fn()),
  };
  return {
    refs,
    module: {
      requestPushPermission: (...args: unknown[]) => refs.requestPushPermission(...args),
      removeFcmToken: (...args: unknown[]) => refs.removeFcmToken(...args),
      removeCurrentFcmToken: (...args: unknown[]) => refs.removeCurrentFcmToken(...args),
      onForegroundMessage: (...args: unknown[]) => refs.onForegroundMessage(...args),
    },
  };
}

/* ──────────────────────────────────────────
 * firebase (app singleton + named exports)
 * ────────────────────────────────────────── */

export interface FirebaseModule {
  firebaseReady: boolean;
  auth: { currentUser: null };
  db: Record<string, never>;
  storage: Record<string, never>;
  default: Record<string, never>;
}

export interface FirebaseMocks {
  // No interactive refs — firebase is purely a dependency stub.
  refs: Record<string, never>;
  module: FirebaseModule;
}

export function createFirebaseMocks(): FirebaseMocks {
  return {
    refs: {},
    module: {
      firebaseReady: true,
      auth: { currentUser: null },
      db: {},
      storage: {},
      default: {},
    },
  };
}

/* ──────────────────────────────────────────
 * services/analytics
 * ────────────────────────────────────────── */

export interface AnalyticsRefs {
  trackEvent: Mock;
  gameCreated: Mock;
  trickSet: Mock;
  matchSubmitted: Mock;
  gameCompleted: Mock;
  videoUploaded: Mock;
  signUp: Mock;
  signIn: Mock;
  signInAttempt: Mock;
  signInFailure: Mock;
  signUpAttempt: Mock;
  signUpFailure: Mock;
}

export interface AnalyticsMocks {
  refs: AnalyticsRefs;
  module: {
    trackEvent: Mock;
    analytics: {
      gameCreated: Mock;
      trickSet: Mock;
      matchSubmitted: Mock;
      gameCompleted: Mock;
      videoUploaded: Mock;
      signUp: Mock;
      signIn: Mock;
      signInAttempt: Mock;
      signInFailure: Mock;
      signUpAttempt: Mock;
      signUpFailure: Mock;
    };
  };
}

export function createAnalyticsMocks(): AnalyticsMocks {
  const refs: AnalyticsRefs = {
    trackEvent: vi.fn(),
    gameCreated: vi.fn(),
    trickSet: vi.fn(),
    matchSubmitted: vi.fn(),
    gameCompleted: vi.fn(),
    videoUploaded: vi.fn(),
    signUp: vi.fn(),
    signIn: vi.fn(),
    signInAttempt: vi.fn(),
    signInFailure: vi.fn(),
    signUpAttempt: vi.fn(),
    signUpFailure: vi.fn(),
  };
  return {
    refs,
    module: {
      trackEvent: refs.trackEvent,
      analytics: {
        gameCreated: refs.gameCreated,
        trickSet: refs.trickSet,
        matchSubmitted: refs.matchSubmitted,
        gameCompleted: refs.gameCompleted,
        videoUploaded: refs.videoUploaded,
        signUp: refs.signUp,
        signIn: refs.signIn,
        signInAttempt: refs.signInAttempt,
        signInFailure: refs.signInFailure,
        signUpAttempt: refs.signUpAttempt,
        signUpFailure: refs.signUpFailure,
      },
    },
  };
}

/* ──────────────────────────────────────────
 * services/blocking
 * ────────────────────────────────────────── */

export interface BlockingServiceRefs {
  blockUser: Mock;
  unblockUser: Mock;
  isUserBlocked: Mock;
  getBlockedUserIds: Mock;
  subscribeToBlockedUsers: Mock;
}

export interface BlockingServiceMocks {
  refs: BlockingServiceRefs;
  module: Record<keyof BlockingServiceRefs, (...args: unknown[]) => unknown>;
}

export function createBlockingServiceMocks(): BlockingServiceMocks {
  const refs: BlockingServiceRefs = {
    blockUser: vi.fn().mockResolvedValue(undefined),
    unblockUser: vi.fn().mockResolvedValue(undefined),
    isUserBlocked: vi.fn().mockResolvedValue(false),
    getBlockedUserIds: vi.fn().mockResolvedValue(new Set<string>()),
    subscribeToBlockedUsers: vi.fn(() => vi.fn()),
  };
  return {
    refs,
    module: {
      blockUser: (...args: unknown[]) => refs.blockUser(...args),
      unblockUser: (...args: unknown[]) => refs.unblockUser(...args),
      isUserBlocked: (...args: unknown[]) => refs.isUserBlocked(...args),
      getBlockedUserIds: (...args: unknown[]) => refs.getBlockedUserIds(...args),
      subscribeToBlockedUsers: (...args: unknown[]) => refs.subscribeToBlockedUsers(...args),
    },
  };
}

/* ──────────────────────────────────────────
 * @sentry/react
 * ────────────────────────────────────────── */

export interface SentryRefs {
  init: Mock;
  captureException: Mock;
  captureMessage: Mock;
  addBreadcrumb: Mock;
}

export interface SentryMocks {
  refs: SentryRefs;
  module: SentryRefs;
}

export function createSentryMocks(): SentryMocks {
  const refs: SentryRefs = {
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
  };
  // For Sentry the refs ARE the module exports — consumers call them by
  // name and we want to assert on the same handles.
  return { refs, module: refs };
}

/* ──────────────────────────────────────────
 * Aggregate factory for smoke tests
 * ────────────────────────────────────────── */

/**
 * Bundle of every per-service mock factory used by smoke-*.test.tsx files.
 *
 * Every smoke test mocks the same set of dependency modules (auth hook,
 * services/auth, services/users, services/userData, services/games,
 * services/storage, services/fcm, firebase, services/analytics, @sentry/react,
 * services/blocking) so that `App` can render without touching real Firebase.
 * The aggregate factory keeps the per-file `vi.hoisted()` block to a single
 * line — see `src/__tests__/smoke-*.test.tsx` for the call site.
 *
 * Note: `userData` is included unconditionally. Smoke tests that don't render
 * the data-export flow simply leave it unmocked at the `vi.mock()` level; the
 * factory call itself has no side effects beyond instantiating `vi.fn()`s.
 */
export interface AllSmokeMocks {
  auth: UseAuthMocks;
  authSvc: AuthServiceMocks;
  users: UsersServiceMocks;
  userData: UserDataServiceMocks;
  games: GamesServiceMocks;
  storage: StorageServiceMocks;
  fcm: FcmServiceMocks;
  firebase: FirebaseMocks;
  analytics: AnalyticsMocks;
  blocking: BlockingServiceMocks;
  sentry: SentryMocks;
}

export function createAllSmokeMocks(): AllSmokeMocks {
  return {
    auth: createUseAuthMocks(),
    authSvc: createAuthServiceMocks(),
    users: createUsersServiceMocks(),
    userData: createUserDataServiceMocks(),
    games: createGamesServiceMocks(),
    storage: createStorageServiceMocks(),
    fcm: createFcmServiceMocks(),
    firebase: createFirebaseMocks(),
    analytics: createAnalyticsMocks(),
    blocking: createBlockingServiceMocks(),
    sentry: createSentryMocks(),
  };
}
