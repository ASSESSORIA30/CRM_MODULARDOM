import { Brand } from "@/components/brand";
import { missingEnvNames } from "@/lib/env";

// Es mostra quan falten les variables de Supabase al desplegament.
// Només llista NOMS de variables, mai valors.
export const dynamic = "force-dynamic";

export default function ConfiguracioPendent() {
  const missing = missingEnvNames();
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-navy px-4">
      <div className="w-full max-w-lg rounded-xl border-t-4 border-gold bg-white p-8 shadow-xl">
        <Brand />
        <h1 className="mt-6 text-xl font-semibold text-navy">Configuració pendent</h1>
        {missing.length > 0 ? (
          <>
            <p className="mt-3 text-muted">
              L&apos;aplicació està desplegada correctament, però encara no està connectada al projecte
              Supabase <code>modulardom-crm</code>. Falten aquestes variables d&apos;entorn:
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-6 font-mono text-sm text-navy">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="mt-4 text-sm text-muted">
              Afegiu-les a Vercel (Settings → Environment Variables) i torneu a desplegar:
              les variables <code>NEXT_PUBLIC_</code> s&apos;incorporen en el moment del build.
            </p>
          </>
        ) : (
          <p className="mt-3 text-muted">La configuració és completa. <a className="text-navy underline" href="/login">Inicia sessió</a>.</p>
        )}
      </div>
    </main>
  );
}
