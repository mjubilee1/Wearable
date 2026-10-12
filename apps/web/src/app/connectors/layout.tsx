import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Connectors");

export default function ConnectorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
