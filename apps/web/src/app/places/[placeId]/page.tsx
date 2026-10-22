import { PlaceIntelligence } from "@/components/PlaceIntelligence";

export default async function PlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  return <PlaceIntelligence placeId={decodeURIComponent(placeId)} />;
}
