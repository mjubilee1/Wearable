"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const TABS = [
  { id: "activity", label: "Talk", href: "/activity" },
  { id: "messages", label: "Messages", href: "/messages" },
] as const;

const ACCOUNT_LINKS = [
  { href: "/profile", label: "Profile" },
  { href: "/connectors", label: "Connectors" },
  { href: "/settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"] | "connectors" | "profile";

export function TabBar({ active }: { active: TabId }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountActive = active === "profile" || active === "connectors";

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = profile?.initials || "?";
  const hue = profile?.avatarHue ?? 174;

  return (
    <nav
      className="fixed inset-x-0 top-0 z-40 border-b border-ink/15 bg-paper"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-6 sm:px-8">
        <Link href="/activity" className="font-display shrink-0 text-xl italic leading-none text-ink">
          nearby
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
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
          <div className="relative ml-1" ref={menuRef}>
            <button
              type="button"
              aria-label="Account"
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((value) => !value)}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white",
                accountActive ? "ring-2 ring-teal ring-offset-2 ring-offset-paper" : "",
              ].join(" ")}
              style={{ backgroundColor: `hsl(${hue} 55% 42%)` }}
            >
              {initials}
            </button>
            {open ? (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-black/10 bg-card py-1 shadow-lg"
              >
                {profile?.name ? (
                  <p className="truncate px-3 py-2 text-xs font-semibold text-muted">{profile.name}</p>
                ) : null}
                {ACCOUNT_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
                  >
                    {item.label}
                  </Link>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    void signOut();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-surface"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
