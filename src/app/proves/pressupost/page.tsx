// Proves de l'editor de pressupostos (dades fictícies, sense desar). Només amb ENABLE_TEST_ROUTES=1.
import { notFound } from "next/navigation";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import { qt } from "@/lib/i18n-pressupostos";
import { actionMessages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default function PressupostProves() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl p-4">
      <QuoteEditor versionId="00000000-0000-0000-0000-0000000000aa" T={qt("ca")} errors={actionMessages("ca").errors}
        vatRates={[0, 400, 1000, 2100]}
        conceptTypes={[
          { code: "construccio", label: "Construcció", defaultVatBp: 1000 },
          { code: "projecte_direccio", label: "Projecte i direcció", defaultVatBp: 2100 },
          { code: "extra_constructiu", label: "Extra constructiu", defaultVatBp: 1000 },
        ]}
        initial={{ locale: "es", intro: "", notes: "", lines: [
          { chapter: "Base", kind: "base", conceptType: "construccio", description: "Construcció habitatge", quantity: "260", unit: "m²", unitPrice: "993", discount: "", vatRateBp: 1000 },
        ] }} />
    </main>
  );
}
