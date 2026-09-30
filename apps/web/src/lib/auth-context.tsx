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
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
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
  age: number;
  role: string;
  interests: string[];
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (next) => {
      setUser(next);
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
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signUp(input) {
        const cred = await createUserWithEmailAndPassword(
          auth,
          input.email,
          input.password,
        );
        const created = await createUserProfile({
          uid: cred.user.uid,
          email: input.email,
          name: input.name,
          age: input.age,
          role: input.role,
          interests: input.interests,
        });
        setProfile(created);
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email);
      },
      async signOut() {
        await firebaseSignOut(auth);
        setProfile(null);
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
    [user, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
