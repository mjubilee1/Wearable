import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Connections");

export default function ConnectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
