// Portal del client: pressupostos publicats del seu projecte (descarregar, i acceptar/rebutjar si està habilitat)
// i extres pendents d'aprovació. L'RLS només retorna el que direcció ha publicat per a aquest client.
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, btnGold, btnSecondary } from "@/components/ui";
import type { AppLocale } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/quotes/calc";
import { QUOTE_STATUS_CLS } from "@/lib/quotes/status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { clientDecideQuoteAction } from "@/app/(app)/pressupostos/actions";
import { clientDecideExtraAction } from "@/app/(app)/projectes/[id]/extres/actions";

type Supa = Awaited<ReturnType<typeof createClient>>;

export async function SectionPressupostos({ supabase, projectId, locale }: { supabase: Supa; projectId: string; locale: AppLocale }) {
  const T = qt(locale), X = qx(locale);
  const base = actionMessages(locale);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const [{ data: versions }, { data: extras }, { data: settings }] = await Promise.all([
    supabase.from("quote_versions").select("id, version, status, issue_date, valid_until, accepted_on, client_decision, quotes(code, title)")
      .eq("project_id", projectId).eq("published_to_client", true).order("published_at", { ascending: false }),
    supabase.from("project_extras").select("id, code, title, description, amount_cents, vat_rate_bp, status, accepted_on, project_extra_milestones(concept, amount_cents, trigger_condition)")
      .eq("project_id", projectId).order("created_at"),
    // Només el flag públic d'habilitació (la resta de la configuració no és accessible al client)
    createAdminClient().from("company_settings").select("client_quote_decisions").maybeSingle(),
  ]);
  const ids = (versions ?? []).map((v) => v.id);
  const { data: totals } = ids.length ? await supabase.from("quote_version_totals").select("version_id, taxable_cents, total_cents, optional_cents").in("version_id", ids) : { data: [] };
  const t = new Map((totals ?? []).map((x) => [x.version_id, x]));
  const decisions = !!settings?.client_quote_decisions;
  return (
    <div className="space-y-4" data-testid="portal-quotes">
      <Card title={X.portalQuotes}>
        {!versions?.length ? <EmptyState>{X.portalNone}</EmptyState> : (
          <ul className="divide-y divide-navy/5">
            {versions.map((v) => {
              const q = (Array.isArray(v.quotes) ? v.quotes[0] : v.quotes) as { code: string; title: string } | null;
              const tt = t.get(v.id);
              return (
                <li key={v.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-navy">{q?.code} · {q?.title} · v{v.version}</span>
                    <Badge className={QUOTE_STATUS_CLS[v.status]}>{T.statuses[v.status]}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {v.issue_date && <>{T.issued}: {formatDate(v.issue_date, locale)} · </>}{v.valid_until && <>{T.validUntil}: {formatDate(v.valid_until, locale)} · </>}
                    {tt && <>{T.taxable}: <b className="text-ink">{formatCents(Number(tt.taxable_cents))}</b> · {T.totalWithVat}: <b className="text-ink">{formatCents(Number(tt.total_cents))}</b></>}
                    {tt && Number(tt.optional_cents) > 0 && <> · {T.optionalNotIncluded}: {formatCents(Number(tt.optional_cents))}</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/pressupostos/${v.id}/pdf`} target="_blank" rel="noopener" className={btnSecondary}>⬇ {T.downloadPdf}</a>
                    {decisions && v.status === "enviat" && (
                      <>
                        <ActionForm action={clientDecideQuoteAction} messages={{ ...messages, saved: X.decided }} submitLabel={`✓ ${X.accept}`} submitClassName={btnGold}>
                          <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="decision" value="acceptat" />
                        </ActionForm>
                        <ActionForm action={clientDecideQuoteAction} messages={{ ...messages, saved: X.decided }} submitLabel={X.reject} submitClassName={btnSecondary}>
                          <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="decision" value="rebutjat" />
                        </ActionForm>
                      </>
                    )}
                    {v.accepted_on && <span className="text-sm text-emerald-700">✓ {T.statuses.acceptat} {formatDate(v.accepted_on, locale)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {!!extras?.length && (
        <Card title={X.extras}>
          <ul className="divide-y divide-navy/5">
            {extras.map((e) => (
              <li key={e.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy">{e.code} · {e.title}</span>
                  <span className="flex items-center gap-2 text-sm"><b>{formatCents(Number(e.amount_cents))}</b> + {formatRate(e.vat_rate_bp)} <Badge>{X.extraStatuses[e.status]}</Badge></span>
                </div>
                {e.description && <p className="text-sm text-muted">{e.description}</p>}
                {decisions && e.status === "pendent_aprovacio" && (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={clientDecideExtraAction} messages={{ ...messages, saved: X.decided }} submitLabel={`✓ ${X.accept}`} submitClassName={btnGold}>
                      <input type="hidden" name="id" value={e.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="decision" value="aprovat" />
                    </ActionForm>
                    <ActionForm action={clientDecideExtraAction} messages={{ ...messages, saved: X.decided }} submitLabel={X.reject} submitClassName={btnSecondary}>
                      <input type="hidden" name="id" value={e.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="decision" value="rebutjat" />
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
