"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";

const TABS = [
  { id: "nearby", label: "Discover", href: "/nearby" },
  { id: "profile", label: "Profile", href: "/profile" },
] as const;

const ACCOUNT_LINKS = [
  { href: "/settings", label: "Settings" },
] as const;

type TabId =
  | (typeof TABS)[number]["id"]
  | "activity"
  | "messages"
  | "connectors"
  | "patterns"
  | "explore";

export function TabBar({ active }: { active: TabId }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <nav
      className="fixed inset-x-0 top-0 z-40 border-b border-ink/10 bg-white"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
        <BrandMark className="shrink-0 text-base font-semibold tracking-tight text-ink" />
        <ul className="flex min-w-0 items-center gap-3 text-sm sm:gap-4">
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  className={
                    isActive
                      ? "font-medium text-ink"
                      : "text-muted hover:text-ink"
                  }
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Account"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((value) => !value)}
            className="text-sm text-muted hover:text-ink"
          >
            Account
          </button>
          {open ? (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-44 border border-ink/10 bg-white py-1"
            >
              {ACCOUNT_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm text-ink hover:bg-surface"
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
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
