"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`)
          || (l.href === "/clients" && pathname.startsWith("/projectes"));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            {active && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle" />}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
