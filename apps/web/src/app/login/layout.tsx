import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Sign in");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
