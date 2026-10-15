import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import {
  EMAIL_VERIFICATION_CONTINUE_URL,
  JUNK_EMAIL_MESSAGE,
  clientNeedsEmailVerification,
  isDottedJunkEmail,
  type UserProfile,
} from "@nearby/shared";
import { auth } from "@/lib/firebase";
import {
  createUserProfile,
  ensureSeedProfiles,
  getUserProfile,
} from "@/lib/users";

type SignUpInput = {
  email: string;
  password: string;
  name: string;
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

      try {
        await ensureSeedProfiles();
        const existing = await getUserProfile(next.uid);
        setProfile(existing);
      } catch (error) {
        console.error("Failed to load profile", error);
        setProfile(null);
      } finally {
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
        const created = await createUserProfile({
          uid: cred.user.uid,
          email: input.email,
          name: input.name,
          age: 0,
          role: "",
          interests: [],
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
