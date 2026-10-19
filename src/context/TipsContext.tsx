import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { isTipsEnabled } from "../lib/featureFlags";
import { loadTips, markTipSeen, resetTips, setTipsDisabled, type TipsState } from "../services/tips";

export interface TipsContextValue {
  /** Feature flag on and a signed-in profile is loaded. */
  available: boolean;
  /** State has loaded for this user. */
  ready: boolean;
  disabled: boolean;
  seen: readonly string[];
  markSeen: (id: string) => void;
  setDisabled: (disabled: boolean) => void;
  replay: () => Promise<void>;
}

const noop = () => undefined;
const OFF: TipsContextValue = {
  available: false,
  ready: false,
  disabled: false,
  seen: [],
  markSeen: noop,
  setDisabled: noop,
  replay: async () => undefined,
};

const TipsContext = createContext<TipsContextValue>(OFF);

/** Safe outside the provider: returns an "off" value so isolated screens still render. */
export function useTipsContext(): TipsContextValue {
  return useContext(TipsContext);
}

export function TipsProvider({ children }: { children: ReactNode }) {
  const { user, activeProfile } = useAuthContext();
  const uid = isTipsEnabled() && user && activeProfile ? user.uid : null;
  const [loaded, setLoaded] = useState<{ uid: string; state: TipsState } | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void loadTips(uid).then((state) => {
      if (!cancelled) setLoaded({ uid, state });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const state = uid && loaded?.uid === uid ? loaded.state : null;

  const markSeen = useCallback(
    (id: string) => {
      if (!uid) return;
      setLoaded((prev) =>
        prev && !prev.state.seen.includes(id)
          ? { uid, state: { ...prev.state, seen: [...prev.state.seen, id] } }
          : prev,
      );
      void markTipSeen(uid, id);
    },
    [uid],
  );

  const setDisabled = useCallback(
    (disabled: boolean) => {
      if (!uid) return;
      setLoaded((prev) => (prev ? { uid, state: { ...prev.state, disabled } } : prev));
      void setTipsDisabled(uid, disabled);
    },
    [uid],
  );

  const replay = useCallback(async () => {
    if (!uid) return;
    setLoaded({ uid, state: { seen: [], disabled: false } });
    await resetTips(uid);
  }, [uid]);

  const value = useMemo<TipsContextValue>(
    () =>
      uid
        ? {
            available: true,
            ready: state !== null,
            disabled: state?.disabled ?? false,
            seen: state?.seen ?? [],
            markSeen,
            setDisabled,
            replay,
          }
        : OFF,
    [uid, state, markSeen, setDisabled, replay],
  );

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
}
