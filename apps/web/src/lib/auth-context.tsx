"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  EMAIL_VERIFICATION_CONTINUE_URL,
  JUNK_EMAIL_MESSAGE,
  clientNeedsEmailVerification,
  isDottedJunkEmail,
} from "@nearby/shared";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type ActionCodeSettings,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { trackFunnel } from "@/lib/funnel";
import {
  createUserProfile,
  ensureSeedProfiles,
  getUserProfile,
} from "@/lib/users";
import type { UserProfile } from "@/lib/types";

type SignUpInput = {
  email: string;
  password: string;
  name: string;
  timeZone?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referredByCode?: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  emailVerified: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  confirmEmailVerified: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const verificationSettings: ActionCodeSettings = {
  url: EMAIL_VERIFICATION_CONTINUE_URL,
  handleCodeInApp: false,
};

const PENDING_SIGNUP_KEY = "nearby_pending_signup_complete";

function markPendingSignup() {
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, "1");
  } catch {
    // Signup still works if storage is blocked.
  }
}

function consumePendingSignup(
  profile: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null } | null,
) {
  try {
    if (localStorage.getItem(PENDING_SIGNUP_KEY) !== "1") return;
  } catch {
    return;
  }
  trackFunnel(
    "signup_complete",
    {
      plan: "free",
      ...(profile?.utmSource ? { utm_source: profile.utmSource } : {}),
      ...(profile?.utmMedium ? { utm_medium: profile.utmMedium } : {}),
      ...(profile?.utmCampaign ? { utm_campaign: profile.utmCampaign } : {}),
    },
    { scope: "local", key: "signup_complete" },
  );
  try {
    localStorage.removeItem(PENDING_SIGNUP_KEY);
  } catch {
    // The funnel key still stops a second event.
  }
}

// TODO: Set the Firebase verification email sender name to "Nearby" in the
// console (Authentication → Templates → Email address verification). The
// client SDK cannot set the sender name.

function userCreatedAtMs(user: User): number {
  const created = Date.parse(user.metadata.creationTime ?? "");
  return Number.isFinite(created) ? created : 0;
}

function needsVerification(user: User, emailVerified: boolean): boolean {
  return clientNeedsEmailVerification({
    emailVerified,
    providerIds: user.providerData.map((provider) => provider.providerId),
    createdAtMs: userCreatedAtMs(user),
  });
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (next) => {
      setUser(next);
      setEmailVerified(next?.emailVerified ?? false);
      if (!next) {
        setProfile(null);
        setLoading(false);
        return;
      }

      let loaded: UserProfile | null = null;
      try {
        await ensureSeedProfiles();
        loaded = await getUserProfile(next.uid);
        setProfile(loaded);
      } catch (error) {
        console.error("Failed to load profile", error);
        setProfile(null);
      } finally {
        if (next.emailVerified && !needsVerification(next, true)) {
          consumePendingSignup(loaded);
        }
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      emailVerified,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signUp(input) {
        if (isDottedJunkEmail(input.email)) {
          throw new Error(JUNK_EMAIL_MESSAGE);
        }
        const cred = await createUserWithEmailAndPassword(
          auth,
          input.email,
          input.password,
        );
        try {
          await sendEmailVerification(cred.user, verificationSettings);
        } catch (error) {
          console.error("Verification email failed", error);
        }
        if (needsVerification(cred.user, cred.user.emailVerified)) {
          markPendingSignup();
        }
        const created = await createUserProfile({
          uid: cred.user.uid,
          email: input.email,
          name: input.name,
          age: 0,
          role: "",
          interests: [],
          timeZone: input.timeZone,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          referredByCode: input.referredByCode,
        });
        setProfile(created);
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email);
      },
      async resendVerificationEmail() {
        const current = auth.currentUser;
        if (!current) throw new Error("Sign in first");
        await sendEmailVerification(current, verificationSettings);
      },
      async confirmEmailVerified() {
        const current = auth.currentUser;
        if (!current) return false;
        await current.reload();
        await current.getIdToken(true);
        const next = auth.currentUser;
        const verified = next?.emailVerified ?? false;
        setUser(next);
        setEmailVerified(verified);
        if (next && verified && !needsVerification(next, verified)) {
          consumePendingSignup(profile);
        }
        return Boolean(next && !needsVerification(next, verified));
      },
      async signOut() {
        await firebaseSignOut(auth);
        setProfile(null);
        setEmailVerified(false);
      },
      async refreshProfile() {
        if (!auth.currentUser) {
          setProfile(null);
          return;
        }
        const next = await getUserProfile(auth.currentUser.uid);
        setProfile(next);
      },
    }),
    [user, profile, loading, emailVerified],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
