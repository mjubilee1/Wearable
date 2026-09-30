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
          Recent walk-bys and score moments.
        </p>
      </header>
      <main className="flex flex-1 items-start">
        <p className="rounded-2xl bg-card px-5 py-8 text-sm text-muted shadow-sm">
          Coming soon
        </p>
      </main>
      <TabBar active="activity" />
    </div>
  );
}
