import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type {
  GeoPoint,
  NearbySpatialPlace,
  ObservationSubmission,
  SpatialInsight,
  SpatialQueryResult,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import { mobileLocationService } from "@/lib/device-location";
import {
  askSpatialQuery,
  getObservationSubmission,
  getPlaceInsights,
  sendInsightFeedback,
  submitImageObservation,
} from "@/lib/spatial-api";

export function ScanSurroundingsSection({
  location,
  places,
}: {
  location: GeoPoint;
  places: NearbySpatialPlace[];
}) {
  const { user } = useAuth();
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submission, setSubmission] = useState<ObservationSubmission | null>(
    null,
  );
  const [insights, setInsights] = useState<SpatialInsight[]>([]);
  const [question, setQuestion] = useState("Which cafés nearby have outlets?");
  const [queryResult, setQueryResult] = useState<SpatialQueryResult | null>(
    null,
  );

  useEffect(() => {
    if (!selectedPlaceId && places[0]) setSelectedPlaceId(places[0].id);
  }, [places, selectedPlaceId]);

  useEffect(() => {
    if (!user || !selectedPlaceId) return;
    void user.getIdToken().then((token) =>
      getPlaceInsights(token, selectedPlaceId).then((response) =>
        setInsights(response.insights),
      ),
    );
  }, [selectedPlaceId, user, submission?.state]);

  useEffect(() => {
    if (!user || !submission) return;
    if (
      submission.state === "published" ||
      submission.state === "review_required" ||
      submission.state === "failed"
    ) {
      return;
    }
    const timer = setInterval(() => {
      void user.getIdToken().then(async (token) => {
        const next = await getObservationSubmission(token, submission.id);
        setSubmission(next);
        if (next.state === "published" && next.placeMatch?.placeId) {
          setSelectedPlaceId(next.placeMatch.placeId);
        }
      });
    }, 800);
    return () => clearInterval(timer);
  }, [submission, user]);

  async function scan() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        throw new Error(
          "Camera permission is required only when you tap Scan surroundings.",
        );
      }
      if (!selectedPlaceId) {
        throw new Error("Select the place this photo shows before scanning.");
      }
      const photo = await ImagePicker.launchCameraAsync({
        quality: 0.55,
        base64: true,
        exif: false,
        allowsEditing: false,
      });
      if (photo.canceled || !photo.assets[0]?.base64) {
        setBusy(false);
        return;
      }
      let spatialLocation;
      try {
        spatialLocation = await mobileLocationService.getCurrentLocation({
          requestPermission: true,
        });
      } catch {
        spatialLocation = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters ?? null,
          timestamp: new Date().toISOString(),
        };
      }
      const token = await user.getIdToken();
      const next = await submitImageObservation(token, {
        image: {
          mediaType: "image/jpeg",
          dataBase64: photo.assets[0].base64,
        },
        location: spatialLocation,
        candidatePlaceId: selectedPlaceId,
      });
      setSubmission(next);
      setNotice(
        "Photo accepted. Nearby Hello keeps only structured attributes—not the image.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not scan surroundings.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runQuery() {
    if (!user || question.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      setQueryResult(await askSpatialQuery(token, question, location));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not answer that question.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Scan surroundings</Text>
      <Text style={styles.body}>
        Take one photo when you choose to. Nearby Hello looks for supported
        visible details, links them only after you pick the place, and never
        keeps the photo.
      </Text>

      <Text style={styles.label}>Place shown in the photo</Text>
      <View style={styles.placePicker}>
        {places.slice(0, 6).map((place) => (
          <Pressable
            key={place.id}
            style={[
              styles.placeOption,
              selectedPlaceId === place.id && styles.placeOptionActive,
            ]}
            onPress={() => setSelectedPlaceId(place.id)}
          >
            <Text
              style={[
                styles.placeOptionText,
                selectedPlaceId === place.id && styles.placeOptionTextActive,
              ]}
            >
              {place.name} · {place.distanceMeters} m
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.scanButton, (!selectedPlaceId || busy) && styles.disabled]}
        disabled={!selectedPlaceId || busy}
        onPress={() => void scan()}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.scanButtonText}>Scan surroundings</Text>
        )}
      </Pressable>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {submission ? (
        <Text style={styles.meta}>
          Status: {submission.state.replaceAll("_", " ")}
          {submission.placeMatch
            ? ` · match ${Math.round(submission.placeMatch.confidence * 100)}%`
            : ""}
        </Text>
      ) : null}

      <View style={styles.insightList}>
        {insights.length ? (
          insights.map((insight) => (
            <View key={insight.id} style={styles.insight}>
              <Text style={styles.insightText}>{insight.text}</Text>
              <Text style={styles.meta}>
                {insight.sourceLabel} ·{" "}
                {insight.verificationStatus.replaceAll("_", " ")} ·{" "}
                {Math.round(insight.confidence * 100)}% confidence
              </Text>
              <View style={styles.feedbackRow}>
                <Pressable
                  onPress={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, true),
                      )
                  }
                >
                  <Text style={styles.feedbackGood}>Looks right</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, false),
                      )
                  }
                >
                  <Text style={styles.feedbackBad}>Not right</Text>
                </Pressable>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>No published insights for this place yet.</Text>
        )}
      </View>

      <Text style={styles.subtitle}>Ask nearby</Text>
      <View style={styles.queryRow}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          style={styles.input}
          placeholderTextColor={colors.muted}
        />
        <Pressable
          style={[styles.askButton, question.trim().length < 3 && styles.disabled]}
          disabled={busy || question.trim().length < 3}
          onPress={() => void runQuery()}
        >
          <Text style={styles.scanButtonText}>Ask</Text>
        </Pressable>
      </View>
      {queryResult ? (
        <Text style={styles.answer}>{queryResult.answer}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  subtitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 18,
  },
  body: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 14,
    textTransform: "uppercase",
  },
  placePicker: { gap: 7, marginTop: 8 },
  placeOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  placeOptionActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  placeOptionText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  placeOptionTextActive: { color: colors.teal },
  scanButton: {
    marginTop: 14,
    backgroundColor: colors.teal,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  scanButtonText: { color: "white", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  notice: {
    marginTop: 10,
    color: colors.teal,
    backgroundColor: colors.tealSoft,
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
  },
  error: {
    marginTop: 10,
    color: colors.coral,
    backgroundColor: colors.coralSoft,
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
  },
  meta: { color: colors.muted, fontSize: 10, marginTop: 8, lineHeight: 14 },
  insightList: { gap: 9, marginTop: 14 },
  insight: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 13,
  },
  insightText: { color: colors.ink, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  feedbackRow: { flexDirection: "row", gap: 14, marginTop: 10 },
  feedbackGood: { color: colors.teal, fontSize: 11, fontWeight: "800" },
  feedbackBad: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  empty: {
    color: colors.muted,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
  },
  queryRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 12,
  },
  askButton: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  answer: {
    marginTop: 10,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
});
