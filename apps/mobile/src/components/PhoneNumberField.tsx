import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  applyNationalPhoneInput,
  listPhoneCountries,
  phonePlaceholder,
  type PhoneCountry,
  type PhoneCountryCode,
} from "@nearby/shared";
import { colors } from "@/lib/theme";

export function PhoneNumberField({
  country,
  national,
  onChange,
}: {
  country: PhoneCountryCode;
  national: string;
  onChange: (next: { country: PhoneCountryCode; national: string }) => void;
}) {
  const countries = useMemo(() => listPhoneCountries(), []);
  const selected = countries.find((item) => item.iso === country);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return countries;
    return countries.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.callingCode.startsWith(needle.replace("+", "")) ||
        item.iso.toLowerCase().includes(needle),
    );
  }, [countries, query]);

  function choose(item: PhoneCountry) {
    onChange(applyNationalPhoneInput(item.iso, national));
    setOpen(false);
    setQuery("");
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Country</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.input}>
        <Text style={styles.value}>
          {selected ? `${selected.name} (+${selected.callingCode})` : "Select a country"}
        </Text>
      </Pressable>
      <Text style={styles.label}>Mobile number</Text>
      <TextInput
        value={national}
        onChangeText={(value) => onChange(applyNationalPhoneInput(country, value))}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder={phonePlaceholder(country)}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Country</Text>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search countries"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            style={styles.search}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.iso}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable onPress={() => choose(item)} style={styles.row}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowCode}>+{item.callingCode}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  value: { fontSize: 14, color: colors.ink },
  sheet: { flex: 1, backgroundColor: colors.card, paddingTop: 56, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink },
  cancel: { fontSize: 14, fontWeight: "700", color: colors.teal },
  search: {
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowName: { fontSize: 15, color: colors.ink },
  rowCode: { fontSize: 15, color: colors.muted },
});
