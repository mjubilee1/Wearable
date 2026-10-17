import Link from "next/link";
import { MemorySettings } from "@/components/MemorySettings";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { TabBar } from "@/components/TabBar";
import { PhoneSetup } from "@/components/PhoneSetup";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8 max-w-xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <div className="mt-1 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Settings</h1>
          <Link href="/profile" className="text-sm font-semibold text-teal">
            Back to profile
          </Link>
        </div>
      </header>
      <main className="max-w-xl flex-1">
        <div className="mb-6">
          <PhoneSetup />
        </div>
        <MemorySettings />
      </main>
      <PrivacyFooter />
      <TabBar active="profile" />
    </div>
  );
}
