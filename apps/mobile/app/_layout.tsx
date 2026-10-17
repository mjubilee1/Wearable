import { useEffect, useState, type ReactNode } from "react";
import { Stack, usePathname, useRouter, useSegments } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clientNeedsEmailVerification, INVITE_STORAGE_KEY, inviteCodeFromPath } from "@nearby/shared";
import { acceptInvite } from "@/lib/phone-messaging";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

function AuthGate({ children }: { children: ReactNode }) {
  const { user, profile, loading, emailVerified } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const pathname = usePathname();
  const root = segments[0];
  const inAuthGroup = root === "(auth)";
  const onIndex = root === undefined || root === "index";
  const onOnboarding = root === "onboarding";
  const onInvite = root === "invite";
  const createdAtMs = user
    ? Date.parse(user.metadata.creationTime ?? "") || 0
    : 0;
  const needsEmail = user
    ? clientNeedsEmailVerification({
        emailVerified,
        providerIds: user.providerData.map((provider) => provider.providerId),
        createdAtMs,
      })
    : false;

  useEffect(() => {
    const code = inviteCodeFromPath(pathname);
    if (!code) return;
    void AsyncStorage.setItem(INVITE_STORAGE_KEY, code);
  }, [pathname]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void AsyncStorage.getItem(INVITE_STORAGE_KEY).then((code) => {
      if (cancelled || !code) return;
      return user.getIdToken().then((token) => acceptInvite(token, code)).then(() => {
        if (!cancelled) return AsyncStorage.removeItem(INVITE_STORAGE_KEY);
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (loading) return;
    if (!user && !inAuthGroup && !onInvite) {
      router.replace("/(auth)/login");
      return;
    }
    if (!user) return;
    if (needsEmail) return;
    if (!profile) return;
    if (profile.phoneOnboardingRequired && !onOnboarding && !onInvite) {
      router.replace("/onboarding");
      return;
    }

    if ((inAuthGroup || onIndex) && !profile.phoneOnboardingRequired) {
      router.replace("/(tabs)/activity");
    }
  }, [user, profile, loading, needsEmail, inAuthGroup, onIndex, onOnboarding, onInvite, router]);

  if (loading || (user && !profile && !needsEmail)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (user && needsEmail) return <VerifyEmailScreen />;
  if (!user && !inAuthGroup && !onInvite) return null;
  if (user && (inAuthGroup || onIndex)) return null;

  return <>{children}</>;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.page,
    gap: 12,
  },
});
