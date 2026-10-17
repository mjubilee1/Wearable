import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import {
  VOICE_MEMO_MAX_SECONDS,
  type VoiceMemo,
  type VoiceMemoAction,
  type VoiceMemoListResponse,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const NOTICE_KEY = "nearby.voice-memo-recording-notice.v1";

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

function clock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function actionTitle(action: VoiceMemoAction): string {
  if (action.type === "reminder") return "Reminder";
  if (action.type === "calendar_event") return "Calendar event";
  return "Email draft";
}

export function VoiceMemoPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const stoppingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftDetails, setDraftDetails] = useState<Record<string, string>>({});
  const [editedDetails, setEditedDetails] = useState<
    Record<string, Record<string, string>>
  >({});

  const memosQuery = useQuery({
    queryKey: ["voice-memos", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) throw new Error("Sign in first");
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/voice-memos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load voice memos");
      return (await res.json()) as VoiceMemoListResponse;
    },
  });

  useEffect(() => {
    if (
      recorderState.isRecording &&
      recorderState.durationMillis >= VOICE_MEMO_MAX_SECONDS * 1000
    ) {
      void stopRecording();
    }
  }, [recorderState.durationMillis, recorderState.isRecording]);

  async function upload(uri: string, durationSeconds: number) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append(
        "audio",
        { uri, name: "memo.m4a", type: "audio/mp4" } as unknown as Blob,
      );
      form.append("durationSeconds", String(Math.max(1, durationSeconds)));
      form.append("timeZone", deviceTimeZone());
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/voice-memos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not process that memo");
      await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not process that memo");
    } finally {
      try {
        new File(uri).delete();
      } catch {
        // The recorder may already have removed its temporary file.
      }
      setBusy(false);
    }
  }

  async function startRecording() {
    if (memosQuery.data?.usage.plan !== "pro") return;
    const noticeKey = `${NOTICE_KEY}:${user?.uid ?? "unknown"}`;
    const acknowledged = await AsyncStorage.getItem(noticeKey);
    if (!acknowledged) {
      Alert.alert(
        "Before you record",
        "Only record others with their permission. You're responsible for following local recording laws.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Continue",
            onPress: () => {
              void AsyncStorage.setItem(noticeKey, "acknowledged").then(() =>
                startRecording(),
              );
            },
          },
        ],
      );
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone access is required to record a voice memo.");
      return;
    }
    try {
      setError(null);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: VOICE_MEMO_MAX_SECONDS });
    } catch {
      setError("Microphone recording could not start.");
    }
  }

  async function stopRecording() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const durationSeconds = Math.max(1, Math.ceil(recorderState.durationMillis / 1000));
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("Recording file was unavailable.");
      await upload(uri, durationSeconds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording could not be saved.");
    } finally {
      stoppingRef.current = false;
    }
  }

  async function decide(
    memo: VoiceMemo,
    action: VoiceMemoAction,
    decision: "confirm" | "skip",
  ) {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${API_URL}/v1/voice-memos/${memo.id}/actions/${action.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            details:
              editing === action.id
                ? draftDetails
                : (editedDetails[action.id] ?? action.details),
            timeZone: deviceTimeZone(),
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not update that action");
      setEditing(null);
      setEditedDetails((current) => {
        const next = { ...current };
        delete next[action.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that action");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemo(id: string) {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/voice-memos/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Could not delete that memo.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
  }

  const data = memosQuery.data;
  const isPro = data?.usage.plan === "pro";
  const atLimit = data?.usage.remainingMinutes === 0;
  const memos = data?.memos ?? [];
  const expanded = recorderState.isRecording || memos.length > 0;

  if (!expanded) {
    return (
      <View style={styles.quiet}>
        <Text style={styles.quietLabel}>Voice memo</Text>
        {!memosQuery.isLoading && !isPro ? (
          <Pressable onPress={() => void Linking.openURL("https://nearbyhello.com/pricing")}>
            <Text style={styles.upgrade}>Upgrade</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={busy || atLimit || memosQuery.isLoading}
            onPress={() => void startRecording()}
          >
            <Text style={styles.upgrade}>{busy ? "Creating recap…" : "Record"}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.label}>Voice memo</Text>
          <Text style={styles.help}>
            Record up to 5 minutes. Nearby creates a recap and follow-ups for you to confirm.
          </Text>
        </View>
        {isPro && data ? (
          <Text style={styles.minutes}>{data.usage.remainingMinutes} min left</Text>
        ) : null}
      </View>

      {memosQuery.isLoading ? (
        <ActivityIndicator color={colors.teal} style={styles.topGap} />
      ) : !isPro ? (
        <View style={styles.row}>
          <Pressable style={styles.recordSecondary} onPress={() => void Linking.openURL("https://nearbyhello.com/pricing")}>
            <Text style={styles.recordSecondaryText}>Record</Text>
          </Pressable>
          <Pressable onPress={() => void Linking.openURL("https://nearbyhello.com/pricing")}>
            <Text style={styles.upgrade}>Upgrade to Pro</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          disabled={busy || atLimit}
          onPress={() =>
            recorderState.isRecording ? void stopRecording() : void startRecording()
          }
          style={[
            styles.record,
            recorderState.isRecording && styles.stop,
            (busy || atLimit) && styles.disabled,
          ]}
        >
          <Text style={styles.recordText}>
            {recorderState.isRecording
              ? `Stop · ${clock(recorderState.durationMillis)}`
              : busy
                ? "Creating recap…"
                : "Record"}
          </Text>
        </Pressable>
      )}
      {atLimit ? (
        <Text style={styles.help}>
          You&apos;ve used this month&apos;s 300 voice memo minutes. Your minutes reset next month.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {memos.map((memo) => (
        <View key={memo.id} style={styles.memo}>
          <Text style={styles.recap}>{memo.recap}</Text>
          <Text style={styles.transcriptLabel}>Transcript</Text>
          <Text style={styles.transcript}>{memo.transcript}</Text>
          {memo.actions.map((action) => {
            const values =
              editing === action.id
                ? draftDetails
                : (editedDetails[action.id] ?? action.details);
            return (
              <View key={action.id} style={styles.action}>
                <View style={styles.heading}>
                  <Text style={styles.actionTitle}>{actionTitle(action)}</Text>
                  {action.status !== "proposed" ? (
                    <Text style={styles.status}>{action.status}</Text>
                  ) : null}
                </View>
                {Object.entries(values).map(([key, value]) =>
                  editing === action.id ? (
                    <View key={key}>
                      <Text style={styles.detailKey}>{key.replaceAll("_", " ")}</Text>
                      <TextInput
                        multiline={key === "body" || key === "description"}
                        value={value}
                        onChangeText={(next) =>
                          setDraftDetails((current) => ({ ...current, [key]: next }))
                        }
                        style={styles.detailInput}
                      />
                    </View>
                  ) : (
                    <Text key={key} style={styles.detail}>
                      <Text style={styles.detailKey}>{key.replaceAll("_", " ")}: </Text>
                      {value}
                    </Text>
                  ),
                )}
                {action.receipt ? (
                  <Text style={styles.done}>Done: {action.receipt.action}</Text>
                ) : null}
                {action.status === "proposed" ? (
                  <View style={styles.actionButtons}>
                    <Pressable style={styles.confirm} onPress={() => void decide(memo, action, "confirm")}>
                      <Text style={styles.confirmText}>Confirm</Text>
                    </Pressable>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => {
                        if (editing === action.id) {
                          setEditedDetails((current) => ({
                            ...current,
                            [action.id]: draftDetails,
                          }));
                          setEditing(null);
                        } else {
                          setDraftDetails(editedDetails[action.id] ?? action.details);
                          setEditing(action.id);
                        }
                      }}
                    >
                      <Text style={styles.smallButtonText}>
                        {editing === action.id ? "Done editing" : "Edit"}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.smallButton} onPress={() => void decide(memo, action, "skip")}>
                      <Text style={styles.smallButtonText}>Skip</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          <Pressable
            onPress={() =>
              Alert.alert("Delete voice memo?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => void deleteMemo(memo.id) },
              ])
            }
          >
            <Text style={styles.delete}>Delete memo</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  quiet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quietLabel: { fontSize: 14, color: colors.muted },
  section: {
    marginTop: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  headingCopy: { flex: 1 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", color: colors.teal },
  help: { marginTop: 8, fontSize: 13, lineHeight: 19, color: colors.muted },
  minutes: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.tealSoft, color: colors.teal, fontSize: 11, fontWeight: "700" },
  topGap: { marginTop: 12 },
  row: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 14 },
  record: { marginTop: 14, borderRadius: 16, minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.teal },
  stop: { backgroundColor: colors.coral },
  recordText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  recordSecondary: { borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.tealSoft },
  recordSecondaryText: { color: colors.teal, fontWeight: "700" },
  upgrade: { color: colors.teal, fontWeight: "700", textDecorationLine: "underline" },
  disabled: { opacity: 0.55 },
  error: { marginTop: 10, color: colors.coral, fontSize: 13 },
  memo: { marginTop: 16, borderRadius: 18, padding: 13, backgroundColor: colors.surface },
  recap: { color: colors.ink, fontSize: 14, lineHeight: 22, fontWeight: "500" },
  transcriptLabel: { marginTop: 12, fontSize: 11, fontWeight: "700", color: colors.muted },
  transcript: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.muted },
  action: { marginTop: 12, borderRadius: 16, padding: 12, backgroundColor: colors.card },
  actionTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.teal },
  status: { fontSize: 11, fontWeight: "700", textTransform: "capitalize", color: colors.muted },
  detail: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.ink },
  detailKey: { fontSize: 11, fontWeight: "700", textTransform: "capitalize", color: colors.muted },
  detailInput: { marginTop: 4, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, color: colors.ink, backgroundColor: colors.card },
  done: { marginTop: 8, fontSize: 12, fontWeight: "700", color: colors.teal },
  actionButtons: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  confirm: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.teal },
  confirmText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  smallButton: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  delete: { marginTop: 12, color: colors.coral, fontSize: 12, fontWeight: "700" },
});
