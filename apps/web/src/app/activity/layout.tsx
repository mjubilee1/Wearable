import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Talk");

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
