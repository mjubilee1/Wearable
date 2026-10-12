import { privateMetadata } from "@/lib/site";

export const metadata = privateMetadata("Get started");

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
