import Link from "next/link";
import { TabBar } from "@/components/TabBar";

export default function ActivityPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          Activity
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          Walk-by moments from your phone’s BLE scan — not from this browser.
        </p>
      </header>
      <main className="flex flex-1 flex-col gap-4">
        <div className="rounded-2xl border border-black/5 bg-card px-5 py-6 shadow-sm">
          <p className="text-sm font-semibold text-ink">BLE debug feed</p>
          <p className="mt-2 text-sm text-muted">
            Clip id, RSSI, close / not close, and green when close + similar
            interests. No names. The site never opens Web Bluetooth.
          </p>
          <Link
            href="/debug/ble"
            className="mt-4 inline-flex rounded-2xl bg-teal px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Open BLE reports
          </Link>
        </div>
      </main>
      <TabBar active="activity" />
    </div>
  );
}
