import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DEFAULT_PHONE_COUNTRY, toE164Phone, type PhoneCountryCode } from "@nearby/shared";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { useAuth } from "@/lib/auth-context";
import {
  checkPhoneVerification,
  getPhone,
  provisionPhone,
  startPhoneVerification,
  type PhoneQuote,
  type PhoneStatus,
} from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

export function PhoneSetup({ onComplete }: { onComplete?: (phone: PhoneStatus) => void }) {
  const { user, refreshProfile } = useAuth();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [quote, setQuote] = useState<PhoneQuote | null>(null);
  const [choice, setChoice] = useState<"personal" | "assigned" | null>(null);
  const [country, setCountry] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void user.getIdToken().then(getPhone).then((result) => {
      setStatus(result.phone);
      setQuote(result.quote);
      if (result.phone.phoneVerified) onComplete?.(result.phone);
    }).catch((err) => setError(err instanceof Error ? err.message : "Could not load phone settings"));
    // Loading is keyed only to the signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function token() {
    if (!user) throw new Error("Sign in first");
    return user.getIdToken();
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    const e164 = toE164Phone(country, phone);
    if (!e164) {
      setError("Enter a valid mobile number for this country.");
      setBusy(false);
      return;
    }
    try {
      await startPhoneVerification(await token(), e164);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const result = await checkPhoneVerification(await token(), code);
      await refreshProfile();
      setStatus(result.phone);
      setChoice(null);
      onComplete?.(result.phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify code");
    } finally {
      setBusy(false);
    }
  }

  function confirmProvision() {
    Alert.alert(
      "Confirm monthly charge",
      `Estimated $${quote?.monthly.toFixed(2) ?? "1.40"}/month, plus possible taxes, carrier, and registration fees.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await provisionPhone(await token());
              await refreshProfile();
              setStatus(result.phone);
              setChoice(null);
              onComplete?.(result.phone);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not assign a number");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (status?.phoneVerified && !choice) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Phone number</Text>
        <Text style={styles.number}>{status.phoneNumber}</Text>
        <Text style={styles.muted}>
          {status.phoneNumberType === "PERSONAL" ? "Personal · verified" : "Nearby-assigned · active"}
        </Text>
        {status.phoneNumberType === "PERSONAL" ? (
          <Pressable onPress={() => { setChoice("personal"); setSent(false); }}>
            <Text style={styles.link}>Change number securely</Text>
          </Pressable>
        ) : (
          <Text style={styles.note}>Contact support before changing an assigned number.</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Choose Your Phone Number</Text>
      <Text style={styles.muted}>Your personal number stays private. Both choices use the same in-app messaging.</Text>
      {!choice ? (
        <View style={styles.options}>
          <Pressable style={styles.option} onPress={() => setChoice("personal")}>
            <Text style={styles.cardTitle}>Use my existing number</Text>
            <Text style={styles.muted}>Verify it with a one-time SMS code.</Text>
          </Pressable>
          <Pressable style={styles.option} onPress={() => setChoice("assigned")}>
            <Text style={styles.cardTitle}>Get a Nearby number</Text>
            <Text style={styles.muted}>Estimated ${quote?.monthly.toFixed(2) ?? "1.40"}/month, plus fees.</Text>
          </Pressable>
        </View>
      ) : null}
      {choice === "personal" ? (
        <View style={styles.form}>
          {sent ? (
            <>
              <Text style={styles.label}>Verification code</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                placeholder="000000"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </>
          ) : (
            <PhoneNumberField
              country={country}
              national={phone}
              onChange={(next) => {
                setCountry(next.country);
                setPhone(next.national);
              }}
            />
          )}
          <Pressable disabled={busy} onPress={sent ? verify : sendCode} style={[styles.primary, busy && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? "Please wait…" : sent ? "Verify number" : "Send verification code"}</Text>
          </Pressable>
        </View>
      ) : null}
      {choice === "assigned" ? (
        <View style={styles.form}>
          <Text style={styles.muted}>{quote?.note}</Text>
          <Pressable disabled={busy} onPress={confirmProvision} style={[styles.primary, busy && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? "Assigning…" : "Confirm and assign number"}</Text>
          </Pressable>
        </View>
      ) : null}
      {choice ? <Pressable disabled={busy} onPress={() => setChoice(null)}><Text style={styles.back}>Back</Text></Pressable> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 18 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  number: { marginTop: 8, fontSize: 18, fontWeight: "700", color: colors.ink },
  muted: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.muted },
  note: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.muted },
  link: { marginTop: 14, fontSize: 13, fontWeight: "700", color: colors.teal },
  options: { marginTop: 16, gap: 10 },
  option: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  form: { marginTop: 16, gap: 10 },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink },
  input: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink },
  primary: { borderRadius: 16, backgroundColor: colors.teal, paddingVertical: 13, alignItems: "center" },
  primaryText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  back: { marginTop: 12, fontSize: 13, fontWeight: "700", color: colors.muted },
  error: { marginTop: 12, borderRadius: 14, backgroundColor: colors.coralSoft, padding: 10 },
  errorText: { fontSize: 13, color: colors.coral },
  disabled: { opacity: 0.6 },
});
