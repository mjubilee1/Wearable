import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSkipLinkRing, setSkipLinkRing } from "@/lib/onboarding";
import { useAuth } from "@/lib/auth-context";

type OnboardingContextValue = {
  /** null = still loading preference */
  skipLinkRing: boolean | null;
  markLinkRingSkipped: () => Promise<void>;
  clearLinkRingSkip: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [skipLinkRing, setSkipState] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setSkipState(null);
      return;
    }
    void getSkipLinkRing().then((skip) => {
      if (!cancelled) setSkipState(skip);
    });
    return () => {
      cancelled = true;
    };
  }, [user, profile?.deviceId]);

  const markLinkRingSkipped = useCallback(async () => {
    await setSkipLinkRing(true);
    setSkipState(true);
  }, []);

  const clearLinkRingSkip = useCallback(async () => {
    await setSkipLinkRing(false);
    setSkipState(false);
  }, []);

  const value = useMemo(
    () => ({ skipLinkRing, markLinkRingSkipped, clearLinkRingSkip }),
    [skipLinkRing, markLinkRingSkipped, clearLinkRingSkip],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
