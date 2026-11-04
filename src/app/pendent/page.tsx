import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentProfile } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { signOut } from "@/app/login/actions";

export default async function PendentPage() {
  const profile = await getCurrentProfile();
  if (profile.isActive) redirect("/inici");
  const d = t(profile.locale);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-navy px-4">
      <div className="w-full max-w-md rounded-xl border-t-4 border-gold bg-white p-8 shadow-xl">
        <Brand />
        <h1 className="mt-6 text-xl font-semibold text-navy">{d.pendingTitle}</h1>
        <p className="mt-3 text-muted">{d.pendingBody}</p>
        <form action={signOut} className="mt-6">
          <button className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark">{d.signOut}</button>
        </form>
      </div>
    </main>
  );
}
