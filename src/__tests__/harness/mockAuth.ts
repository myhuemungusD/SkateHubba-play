/**
 * Ergonomic helpers for driving the mocked `useAuth` hook inside smoke tests.
 *
 * Usage:
 *   const auth = vi.hoisted(() => createUseAuthMocks());
 *   vi.mock("../hooks/useAuth", () => auth.module);
 *   const { asSignedOut, asVerifiedUser } = makeAuthStateSetters(auth.refs);
 *
 *   asSignedOut();           // no user, no profile
 *   asVerifiedUser();        // canonical verifiedUser + testProfile
 *   asUnverifiedUser();      // canonical authedUser + testProfile
 *   asLoadingAuth();         // loading spinner path
 *
 * Each setter returns the currently-installed `refreshProfile` spy so tests
 * that care about refresh-profile interactions can assert on it without
 * re-creating their own spy.
 */
import { vi, type Mock } from "vitest";
import { authedUser, verifiedUser, testProfile, type MockAuthUser } from "./mockFactories";
import type { UserProfile } from "../../services/users";

export interface AuthStateSetters {
  asSignedOut: () => Mock;
  asLoadingAuth: () => Mock;
  asUnverifiedUser: (profile?: UserProfile | null, user?: MockAuthUser) => Mock;
  asVerifiedUser: (profile?: UserProfile | null, user?: MockAuthUser) => Mock;
  /**
   * Escape hatch for tests that need a totally custom auth shape
   * (e.g. a user with a null email, or a mid-flight mutation). Returns the
   * refreshProfile spy installed on the current state.
   */
  setAuthState: (state: { loading?: boolean; user: MockAuthUser | null; profile?: UserProfile | null }) => Mock;
}

export function makeAuthStateSetters(refs: { useAuth: Mock }): AuthStateSetters {
  function setAuthState(state: { loading?: boolean; user: MockAuthUser | null; profile?: UserProfile | null }): Mock {
    const refreshProfile = vi.fn();
    refs.useAuth.mockReturnValue({
      loading: state.loading ?? false,
      user: state.user,
      profile: state.profile ?? null,
      refreshProfile,
    });
    return refreshProfile;
  }

  return {
    asSignedOut: () => setAuthState({ user: null, profile: null }),
    asLoadingAuth: () => setAuthState({ loading: true, user: null, profile: null }),
    asUnverifiedUser: (profile: UserProfile | null = testProfile, user: MockAuthUser = authedUser) =>
      setAuthState({ user, profile }),
    asVerifiedUser: (profile: UserProfile | null = testProfile, user: MockAuthUser = verifiedUser) =>
      setAuthState({ user, profile }),
    setAuthState,
  };
}
