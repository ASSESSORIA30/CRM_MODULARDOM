import { Brand } from "@/components/brand";
import { t } from "@/lib/i18n";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; lang?: string }>;
}) {
  const { next, lang } = await searchParams;
  const locale = lang === "es" ? "es" : "ca";
  const d = t(locale);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Brand light /></div>
        <div className="rounded-xl border-t-4 border-gold bg-white p-8 shadow-xl">
          <h1 className="mb-6 text-xl font-semibold text-navy">{d.login}</h1>
          <LoginForm
            next={next}
            d={{ email: d.email, password: d.password, signIn: d.signIn, invalidCredentials: d.invalidCredentials, genericError: d.genericError }}
          />
        </div>
        <p className="mt-6 text-center text-sm text-white/70">
          <a href="?lang=ca" className={locale === "ca" ? "text-gold" : "hover:text-white"}>Català</a>
          <span className="mx-2">·</span>
          <a href="?lang=es" className={locale === "es" ? "text-gold" : "hover:text-white"}>Castellano</a>
        </p>
      </div>
    </main>
  );
}
