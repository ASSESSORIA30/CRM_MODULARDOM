import Link from "next/link";
import { Brand } from "@/components/brand";
import { NavLinks } from "@/components/nav-links";
import { requireActiveProfile, type AppRole } from "@/lib/auth";
import { roleName, t, type Dict } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { setLocale } from "./actions";

// Només mòduls implementats (cap botó decoratiu). Les fases següents n'hi afegiran.
const NAV: { href: string; key: keyof Dict; roles: AppRole[] }[] = [
  { href: "/inici", key: "home", roles: ["direccio", "arquitecte", "constructor", "client"] },
  { href: "/clients", key: "clients", roles: ["direccio"] },
  { href: "/kanban", key: "kanban", roles: ["direccio"] },
  { href: "/portal", key: "myPreproject", roles: ["client"] },
  { href: "/calendari", key: "calendar", roles: ["direccio", "arquitecte", "constructor", "client"] },
  { href: "/tasques", key: "tasks", roles: ["direccio", "arquitecte", "constructor"] },
  { href: "/administracio/usuaris", key: "admin", roles: ["direccio"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireActiveProfile();
  const d = t(profile.locale);
  const supabase = await createClient();

  // Genera recordatoris pendents (tasques vençudes, cites properes, leads sense resposta)
  await supabase.rpc("refresh_my_notifications");
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  const links = NAV.filter((n) => n.roles.includes(profile.role)).map((n) => ({ href: n.href, label: String(d[n.key]) }));

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="bg-navy text-white print:hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <div className="flex items-center justify-between p-5">
          <Link href="/inici"><Brand light /></Link>
          <Link href="/notificacions" className="relative rounded-full p-2 hover:bg-white/10 md:hidden" aria-label={d.notifications}>
            <BellIcon />
            {!!unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-gold px-1.5 text-[10px] font-bold text-navy-dark">{unread}</span>}
          </Link>
        </div>
        <NavLinks links={links} />
        <div className="mt-auto hidden border-t border-white/10 p-5 text-sm md:block">
          <Link href="/notificacions" className="mb-4 flex items-center gap-2 rounded-md px-1 py-1 hover:bg-white/10">
            <BellIcon />
            <span>{d.notifications}</span>
            {!!unread && <span className="ml-auto rounded-full bg-gold px-2 text-xs font-bold text-navy-dark">{unread}</span>}
          </Link>
          <p className="font-medium">{profile.fullName || profile.email}</p>
          <p className="text-gold">{roleName(profile.locale, profile.role)}</p>
          <div className="mt-3 flex items-center gap-3">
            <form action={setLocale} className="flex gap-1">
              {(["ca", "es"] as const).map((l) => (
                <button key={l} name="locale" value={l}
                  className={`rounded px-1.5 py-0.5 text-xs uppercase ${profile.locale === l ? "bg-gold text-navy-dark" : "text-white/70 hover:text-white"}`}>
                  {l}
                </button>
              ))}
            </form>
            <form action={signOut} className="ml-auto">
              <button className="text-white/70 underline-offset-4 hover:text-white hover:underline">{d.signOut}</button>
            </form>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3 text-sm md:hidden">
          <span className="truncate">{profile.fullName || profile.email}</span>
          <form action={setLocale} className="flex gap-1">
            {(["ca", "es"] as const).map((l) => (
              <button key={l} name="locale" value={l}
                className={`rounded px-1.5 py-0.5 text-xs uppercase ${profile.locale === l ? "bg-gold text-navy-dark" : "text-white/70"}`}>
                {l}
              </button>
            ))}
          </form>
          <form action={signOut} className="ml-auto"><button className="text-white/70">{d.signOut}</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-10 print:p-0">{children}</main>
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
