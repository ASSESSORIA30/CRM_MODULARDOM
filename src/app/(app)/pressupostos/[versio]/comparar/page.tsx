// Comparació econòmica entre dues versions del mateix pressupost.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { formatCents } from "@/lib/money";
import { quoteTotals } from "@/lib/quotes/calc";
import { diffVersions } from "@/lib/quotes/compare";
import { loadQuoteVersion } from "@/lib/quotes/load";
import { createClient } from "@/lib/supabase/server";

const CHANGE_CLS: Record<string, string> = { added: "bg-emerald-50", removed: "bg-red-50", changed: "bg-amber-50", unchanged: "" };

export default async function ComparePage({ params, searchParams }: { params: Promise<{ versio: string }>; searchParams: Promise<{ amb?: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { versio } = await params;
  const { amb } = await searchParams;
  const uuid = /^[0-9a-f-]{36}$/;
  if (!uuid.test(versio) || !amb || !uuid.test(amb)) notFound();
  const supabase = await createClient();
  const [x, y] = await Promise.all([loadQuoteVersion(supabase, versio), loadQuoteVersion(supabase, amb)]);
  if (!x || !y || x.quote.id !== y.quote.id) notFound();
  const [a, b] = x.version.version < y.version.version ? [x, y] : [y, x];
  const T = qt(profile.locale);
  const X = qx(profile.locale);
  const rows = diffVersions(a.lines, b.lines);
  const ta = quoteTotals(a.lines), tb = quoteTotals(b.lines);
  const delta = (n: number) => (n === 0 ? "—" : `${n > 0 ? "+" : ""}${formatCents(n)}`);
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={`${X.compare} · ${a.quote.code}`} subtitle={`${a.quote.title}`}
        actions={<Link href={`/pressupostos/${versio}`} className={btnSecondary}>← v{x.version.version}</Link>} />
      <nav className="flex flex-wrap gap-2 text-sm">
        {a.versions.map((v) => v.id !== versio && (
          <Link key={v.id} href={`/pressupostos/${versio}/comparar?amb=${v.id}`} className={`rounded-full border px-3 py-1 ${v.id === amb ? "border-navy bg-navy text-white" : "border-navy/15 bg-white"}`}>
            {X.compareWith} v{v.version}
          </Link>
        ))}
      </nav>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" data-testid="compare-table">
            <thead className="text-left text-xs text-muted">
              <tr><th className="p-2">{T.description}</th><th className="p-2">{T.kind}</th><th className="p-2 text-right">v{a.version.version}</th>
                <th className="p-2 text-right">v{b.version.version}</th><th className="p-2 text-right">{X.difference}</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-navy/5 ${CHANGE_CLS[r.change]}`}>
                  <td className="p-2">{r.description}</td>
                  <td className="p-2 text-xs text-muted">{T.kinds[r.kind]}</td>
                  <td className="p-2 text-right tabular-nums">{r.a ? <>{formatCents(r.a.amountCents)}{r.a.status !== "inclosa" ? <span className="ml-1 text-xs text-muted">({T.lineStatuses[r.a.status]})</span> : null}</> : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{r.b ? <>{formatCents(r.b.amountCents)}{r.b.status !== "inclosa" ? <span className="ml-1 text-xs text-muted">({T.lineStatuses[r.b.status]})</span> : null}</> : "—"}</td>
                  <td className="p-2 text-right font-medium tabular-nums">{delta(r.deltaCents)}</td>
                  <td className="p-2"><Badge>{X[r.change]}</Badge></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-navy/20 font-semibold text-navy">
              <tr><td className="p-2" colSpan={2}>{T.taxable}</td><td className="p-2 text-right">{formatCents(ta.taxableCents)}</td><td className="p-2 text-right">{formatCents(tb.taxableCents)}</td><td className="p-2 text-right" data-testid="delta-taxable">{delta(tb.taxableCents - ta.taxableCents)}</td><td /></tr>
              <tr><td className="p-2" colSpan={2}>{T.vat}</td><td className="p-2 text-right">{formatCents(ta.vatCents)}</td><td className="p-2 text-right">{formatCents(tb.vatCents)}</td><td className="p-2 text-right">{delta(tb.vatCents - ta.vatCents)}</td><td /></tr>
              <tr><td className="p-2" colSpan={2}>{T.totalWithVat}</td><td className="p-2 text-right">{formatCents(ta.totalCents)}</td><td className="p-2 text-right">{formatCents(tb.totalCents)}</td><td className="p-2 text-right">{delta(tb.totalCents - ta.totalCents)}</td><td /></tr>
              <tr className="font-normal text-sky-800"><td className="p-2" colSpan={2}>{T.optionalNotIncluded}</td><td className="p-2 text-right">{formatCents(ta.optionalCents)}</td><td className="p-2 text-right">{formatCents(tb.optionalCents)}</td><td className="p-2 text-right">{delta(tb.optionalCents - ta.optionalCents)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
