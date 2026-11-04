import { Brand } from "@/components/brand";
import { getCurrentProfile } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { PasswordForm } from "./password-form";

export default async function ContrasenyaPage() {
  const profile = await getCurrentProfile();
  const d = t(profile.locale);
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-xl border-t-4 border-gold bg-white p-8 shadow-xl">
        <Brand />
        <h1 className="mt-6 mb-4 text-xl font-semibold text-navy">{d.newPassword}</h1>
        <PasswordForm d={d} />
      </div>
    </main>
  );
}
