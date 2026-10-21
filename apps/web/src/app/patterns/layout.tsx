import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Patterns · Nearby Hello");

export default function PatternsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
