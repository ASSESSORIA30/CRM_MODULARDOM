import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import type { AppLocale } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import type { QuoteTexts } from "@/lib/i18n-pressupostos";
import { formatCents } from "@/lib/money";
import type { QuoteRow } from "@/lib/quotes/list";
import { QUOTE_STATUS_CLS } from "@/lib/quotes/status";

export function QuoteTable({ rows, T, L, showProject }: { rows: QuoteRow[]; T: QuoteTexts; L: AppLocale; showProject: boolean }) {
  if (!rows.length) return <EmptyState>{T.none}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid="quote-list">
        <thead className="text-left text-xs text-muted">
          <tr><th className="p-2">{T.code}</th>{showProject && <th className="p-2">{T.project}</th>}<th className="p-2">{T.quoteTitle}</th>
            <th className="p-2">{T.version}</th><th className="p-2">{T.status}</th><th className="p-2">{T.issued}</th>
            <th className="p-2 text-right">{T.taxable}</th><th className="p-2 text-right">{T.total}</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-navy/5 hover:bg-surface">
              <td className="p-2 font-mono"><Link href={`/pressupostos/${r.current!.id}`} className="font-semibold text-navy hover:text-gold">{r.code}</Link></td>
              {showProject && <td className="p-2">{r.project ? <Link href={`/projectes/${r.projectId}`} className="hover:text-gold">{r.project.code} · {r.project.title}</Link> : "—"}</td>}
              <td className="p-2">{r.title}</td>
              <td className="p-2">v{r.current!.version}{r.versionCount > 1 ? ` / ${r.versionCount}` : ""}</td>
              <td className="p-2"><Badge className={QUOTE_STATUS_CLS[r.current!.status]}>{T.statuses[r.current!.status]}</Badge></td>
              <td className="p-2">{r.current!.issue_date ? formatDate(r.current!.issue_date, L) : "—"}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(r.taxableCents)}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(r.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
