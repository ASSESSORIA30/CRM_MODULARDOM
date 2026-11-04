import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireActiveProfile } from "@/lib/auth";
import { roleName, t } from "@/lib/i18n";
import { signOut } from "@/app/login/actions";

// Només s'hi afegeixen mòduls quan estan implementats (cap botó decoratiu).
const NAV = [{ href: "/inici", key: "home" as const, roles: ["direccio", "arquitecte", "constructor", "client"] }];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireActiveProfile();
  const d = t(profile.locale);

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="bg-navy text-white md:w-64 md:shrink-0">
        <div className="flex items-center justify-between p-5 md:block">
          <Brand light />
        </div>
        <nav className="px-3 pb-3">
          {NAV.filter((n) => n.roles.includes(profile.role)).map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-white/10">
              {d[n.key]}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 p-5 text-sm">
          <p className="font-medium">{profile.fullName || profile.email}</p>
          <p className="text-gold">{roleName(profile.locale, profile.role)}</p>
          <form action={signOut} className="mt-3">
            <button className="text-white/70 underline-offset-4 hover:text-white hover:underline">{d.signOut}</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
