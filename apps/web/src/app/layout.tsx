import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AuthGate } from "@/components/AuthGate";
import { Providers } from "@/components/Providers";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nearby — Proximity Matches",
  description: "People around you (~40–50 ft).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plusJakarta.variable} antialiased`}>
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}
