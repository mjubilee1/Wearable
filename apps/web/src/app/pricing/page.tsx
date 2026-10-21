import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Nearby Hello",
  description: "Nearby Hello spatial intelligence.",
  robots: { index: false, follow: false },
};

export default function PricingPage() {
  redirect("/");
}
