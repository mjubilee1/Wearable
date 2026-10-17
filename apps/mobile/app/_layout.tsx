import { useEffect, useState, type ReactNode } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clientNeedsEmailVerification } from "@nearby/shared";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

function AuthGate({ children }: { children: ReactNode }) {
  const { user, profile, loading, emailVerified } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const root = segments[0];
  const inAuthGroup = root === "(auth)";
  const onIndex = root === undefined || root === "index";
  const onOnboarding = root === "onboarding";
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
    if (loading) return;
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
      return;
    }
    if (!user) return;
    if (needsEmail) return;
    if (!profile) return;
    if (profile.phoneOnboardingRequired && !onOnboarding) {
      router.replace("/onboarding");
      return;
    }

    if ((inAuthGroup || onIndex) && !profile.phoneOnboardingRequired) {
      router.replace("/(tabs)/activity");
    }
  }, [user, profile, loading, needsEmail, inAuthGroup, onIndex, onOnboarding, router]);

  if (loading || (user && !profile && !needsEmail)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (user && needsEmail) return <VerifyEmailScreen />;
  if (!user && !inAuthGroup) return null;
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
