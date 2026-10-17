import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

const COOLDOWN_MS = 60_000;
let resendCooldownUntil = 0;

export function VerifyEmailScreen() {
  const { user, resendVerificationEmail, confirmEmailVerified, signOut } = useAuth();
  const [cooldownUntil, setCooldownUntil] = useState(resendCooldownUntil);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);

  useEffect(() => {
    if (Date.now() >= cooldownUntil) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function onResend() {
    if (remaining > 0 || busy) return;
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      await resendVerificationEmail();
      const until = Date.now() + COOLDOWN_MS;
      resendCooldownUntil = until;
      setCooldownUntil(until);
      setNow(Date.now());
      setNotice("Sent. Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the email");
    } finally {
      setBusy(null);
    }
  }

  async function onVerified() {
    if (busy) return;
    setBusy("check");
    setError(null);
    setNotice(null);
    try {
      const verified = await confirmEmailVerified();
      if (!verified) {
        setError("That email isn't verified yet. Check your inbox and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh your account");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.screen}>
      <BrandMark style={styles.eyebrow} />
      <Text style={styles.title}>Check your inbox to verify your email</Text>
      <Text style={styles.body}>
        We sent a link{user?.email ? ` to ${user.email}` : ""}. Open it, then
        continue here.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Pressable
        disabled={busy !== null}
        onPress={() => void onVerified()}
        style={[styles.primary, busy !== null && styles.disabled]}
      >
        <Text style={styles.primaryLabel}>
          {busy === "check" ? "Checking…" : "I've verified"}
        </Text>
      </Pressable>
      <Pressable
        disabled={busy !== null || remaining > 0}
        onPress={() => void onResend()}
        style={[styles.secondary, (busy !== null || remaining > 0) && styles.disabled]}
      >
        <Text style={styles.secondaryLabel}>
          {remaining > 0
            ? `Resend email in ${remaining}s`
            : busy === "resend"
              ? "Sending…"
              : "Resend email"}
        </Text>
      </Pressable>
      <Pressable disabled={busy !== null} onPress={() => void signOut()}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.page,
    paddingHorizontal: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: "700",
    color: colors.ink,
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    color: colors.muted,
  },
  error: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
    color: colors.coral,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
  },
  notice: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    color: colors.teal,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
  },
  primary: {
    marginTop: 32,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryLabel: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  secondary: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
    backgroundColor: colors.card,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryLabel: {
    color: colors.ink,
    fontWeight: "600",
    fontSize: 14,
  },
  signOut: {
    marginTop: 8,
    textAlign: "center",
    color: colors.muted,
    fontWeight: "600",
    fontSize: 14,
    paddingVertical: 14,
  },
  disabled: {
    opacity: 0.6,
  },
});
