import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Explore · Nearby Hello");

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
