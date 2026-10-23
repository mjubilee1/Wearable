import Link from "next/link";
import { MemorySettings } from "@/components/MemorySettings";
import { SensingNetworkSettings } from "@/components/SensingNetworkSettings";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { TabBar } from "@/components/TabBar";

export default function SettingsPage() {
  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-16 pt-20">
      <header className="mb-8 max-w-md">
        <Link
          href="/profile"
          className="text-sm text-muted hover:text-ink"
        >
          ← Profile
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Sensing, memory, and how Nearby Hello uses your contributions.
        </p>
      </header>
      <main className="max-w-md flex-1 space-y-8">
        <MemorySettings />
        <SensingNetworkSettings />
      </main>
      <PrivacyFooter />
      <TabBar active="profile" />
    </div>
  );
}
