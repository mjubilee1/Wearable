import { useEffect, useState } from "react";
import { Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import {
  DEFAULT_PHONE_COUNTRY,
  inviteJoinMessage,
  toE164Phone,
  type PhoneCountryCode,
} from "@nearby/shared";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { useAuth } from "@/lib/auth-context";
import { createInvite } from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

function origin(): string {
  const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
  if (api.includes("localhost") || api.includes("127.0.0.1")) return "http://localhost:3000";
  return "https://nearbyhello.com";
}

export function InvitePanel() {
  const { user } = useAuth();
  const [link, setLink] = useState<string | null>(null);
  const [country, setCountry] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY);
  const [national, setNational] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void user
      .getIdToken()
      .then(createInvite)
      .then(({ code }) => {
        if (!cancelled) setLink(`${origin()}/invite/${code}`);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not create an invite");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function shareLink() {
    if (!link) return;
    setError(null);
    try {
      await Share.share({ message: inviteJoinMessage(link) });
    } catch {
      setError("Could not share the link.");
    }
  }

  async function textLink() {
    if (!link) return;
    const e164 = toE164Phone(country, national);
    if (!e164) {
      setError("Enter their mobile number, or share the link instead.");
      return;
    }
    setError(null);
    const body = encodeURIComponent(inviteJoinMessage(link));
    const separator = "?";
    const opened = await Linking.openURL(`sms:${e164}${separator}body=${body}`).then(
      () => true,
      () => false,
    );
    if (!opened) setNotice("Could not open Messages. Share the link instead.");
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Invite someone</Text>
      <Text style={styles.muted}>
        They create an account from your link, then you can message them here. Nearby does not send the conversation.
      </Text>
      <Pressable disabled={!link} onPress={() => void shareLink()} style={[styles.primary, !link && styles.disabled]}>
        <Text style={styles.primaryText}>Share link</Text>
      </Pressable>
      <PhoneNumberField
        country={country}
        national={national}
        onChange={(next) => {
          setCountry(next.country);
          setNational(next.national);
          setError(null);
        }}
      />
      <Pressable disabled={!link} onPress={() => void textLink()} style={[styles.secondary, !link && styles.disabled]}>
        <Text style={styles.secondaryText}>Text the link</Text>
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  title: { fontSize: 14, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 13, lineHeight: 18, color: colors.muted },
  primary: { borderRadius: 16, backgroundColor: colors.teal, paddingVertical: 12, alignItems: "center" },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  secondary: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  notice: { fontSize: 13, color: colors.teal },
  error: { fontSize: 13, color: colors.coral },
  disabled: { opacity: 0.6 },
});
