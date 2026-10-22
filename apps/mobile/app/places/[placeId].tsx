import { useLocalSearchParams } from "expo-router";
import { PlaceIntelligence } from "@/components/PlaceIntelligence";

export default function PlaceScreen() {
  const params = useLocalSearchParams<{ placeId: string }>();
  const raw = Array.isArray(params.placeId) ? params.placeId[0] : params.placeId;
  const placeId = decodeURIComponent(raw ?? "");
  return <PlaceIntelligence placeId={placeId} />;
}
