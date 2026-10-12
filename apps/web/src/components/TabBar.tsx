"use client";

import Link from "next/link";

const TABS = [
  { id: "activity", label: "Talk", href: "/activity" },
  { id: "connectors", label: "Connectors", href: "/connectors" },
  { id: "profile", label: "Profile", href: "/profile" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function TabBar({ active }: { active: TabId }) {
  return (
    <nav
      className="fixed inset-x-0 top-0 z-40 border-b border-black/5 bg-white/80 backdrop-blur-md"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-6 sm:px-8">
        <Link href="/activity" className="shrink-0 text-sm font-bold tracking-tight text-ink">
          Nearby
        </Link>
        <ul className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  className={[
                    "rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm",
                    isActive
                      ? "bg-teal-soft text-teal"
                      : "text-muted hover:bg-surface hover:text-ink",
                  ].join(" ")}
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
