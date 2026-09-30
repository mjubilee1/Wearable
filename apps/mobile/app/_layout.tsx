import { useEffect, useState, type ReactNode } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const root = segments[0];
  const inAuthGroup = root === "(auth)";
  const onIndex = root === undefined || root === "index";

  useEffect(() => {
    if (loading) return;
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
      return;
    }
    if (user && (inAuthGroup || onIndex)) {
      router.replace("/(tabs)");
    }
  }, [user, loading, inAuthGroup, onIndex, router]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal} size="large" />
        <Text style={styles.loadingText}>Connecting…</Text>
      </View>
    );
  }

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
  loadingText: { fontSize: 14, color: colors.muted },
});
