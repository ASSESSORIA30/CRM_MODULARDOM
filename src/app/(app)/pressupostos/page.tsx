import { QuoteTable } from "@/components/quotes/quote-table";
import { Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { qt } from "@/lib/i18n-pressupostos";
import { listQuotes } from "@/lib/quotes/list";
import { createClient } from "@/lib/supabase/server";

export default async function Pressupostos() {
  const profile = await requireRole("direccio");
  const T = qt(profile.locale);
  const rows = await listQuotes(await createClient());
  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={T.allQuotes} subtitle={T.newQuoteHint} />
      <Card><QuoteTable rows={rows} T={T} L={profile.locale} showProject /></Card>
    </div>
  );
}
