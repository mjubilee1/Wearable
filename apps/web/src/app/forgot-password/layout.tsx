import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Reset password");

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
