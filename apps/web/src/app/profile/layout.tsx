import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Profile");

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
