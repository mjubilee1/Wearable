"use client";

import Link from "next/link";

const TABS = [
  { id: "nearby", label: "Nearby", href: "/" },
  { id: "connections", label: "Connections", href: "/connections" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "profile", label: "Profile", href: "/profile" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function TabBar({ active }: { active: TabId }) {
  return (
    <nav
      className="fixed inset-x-0 top-0 z-40 border-b border-black/5 bg-white/80 backdrop-blur-md"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-3 sm:px-8">
        <Link href="/" className="text-sm font-bold tracking-tight text-ink">
          Nearby
        </Link>
        <ul className="flex items-center gap-1">
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  className={[
                    "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
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
