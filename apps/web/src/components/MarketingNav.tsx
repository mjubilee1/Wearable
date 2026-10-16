import Link from "next/link";

const LINKS = [{ href: "/pricing", label: "Pricing" }] as const;

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink/15 bg-paper text-ink">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
        <div className="flex items-baseline gap-8">
          <Link href="/" className="font-display text-2xl italic leading-none text-ink">
            nearby
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-ink">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-muted hover:text-ink">
            Sign in
          </Link>
          <Link href="/signup" className="bg-ink px-3 py-2 text-sm font-semibold text-white">
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
