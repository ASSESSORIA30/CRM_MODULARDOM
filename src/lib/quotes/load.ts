// Lectura d'una versió de pressupost (servidor). L'RLS limita què pot veure cadascú.
import "server-only";
import type { AppLocale } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { QuotePdfData } from "./quote-pdf";
import type { LineKind, LineStatus } from "./calc";

type Supa = Awaited<ReturnType<typeof createClient>>;

export type EditorLine = {
  chapter: string; kind: LineKind; conceptType: string; description: string;
  quantity: string; unit: string; unitPrice: string; discount: string; vatRateBp: number;
  status?: LineStatus; catalogKey?: string | null; catalogUnitPriceCents?: number | null;
  needsReview?: boolean; sourceRef?: string; constructorVisible?: boolean;
};

const toMilli = (q: string | number) => Math.round(Number(q) * 1000);

export async function loadQuoteVersion(supabase: Supa, versionId: string) {
  const { data: v } = await supabase.from("quote_versions")
    .select("id, quote_id, project_id, version, status, source, locale, issue_date, valid_until, intro, notes, exclusions, payment_terms, sent_at, accepted_on, accepted_at, pdf_document_id, created_at, created_by, published_to_client, published_at, is_current, client_decision, client_decided_at, origin_import_id, tariff_version_id, configurator_input")
    .eq("id", versionId).maybeSingle();
  if (!v) return null;
  const [{ data: quote }, { data: project }, { data: lines }, { data: versions }, { data: holders }] = await Promise.all([
    supabase.from("quotes").select("id, code, title, accepted_version_id").eq("id", v.quote_id).single(),
    supabase.from("projects").select("id, code, title, plot_address, municipality").eq("id", v.project_id).single(),
    supabase.from("quote_lines").select("id, position, chapter, kind, status, concept_type, description, quantity, unit, unit_price_cents, discount_bp, vat_rate_bp, amount_cents, catalog_key, catalog_unit_price_cents, price_overridden, needs_review, source_ref, constructor_visible")
      .eq("version_id", versionId).order("position"),
    supabase.from("quote_versions").select("id, version, status, sent_at, created_at, accepted_on, is_current, published_to_client").eq("quote_id", v.quote_id).order("version", { ascending: false }),
    supabase.from("project_holders").select("is_primary, clients(display_name, tax_id, address)").eq("project_id", v.project_id).order("is_primary", { ascending: false }),
  ]);
  if (!quote || !project) return null;
  return {
    version: v, quote, project, versions: versions ?? [],
    lines: (lines ?? []).map((l) => ({
      id: l.id, kind: l.kind as LineKind, status: l.status as LineStatus, chapter: l.chapter, description: l.description, unit: l.unit, conceptType: l.concept_type ?? "",
      catalogKey: l.catalog_key, catalogUnitPriceCents: l.catalog_unit_price_cents == null ? null : Number(l.catalog_unit_price_cents),
      priceOverridden: l.price_overridden, needsReview: l.needs_review, sourceRef: l.source_ref ?? "", constructorVisible: l.constructor_visible,
      quantityMilli: toMilli(l.quantity), unitPriceCents: Number(l.unit_price_cents), discountBp: l.discount_bp, vatRateBp: l.vat_rate_bp,
      amountCents: Number(l.amount_cents),
    })),
    holders: (holders ?? []).map((h) => {
      const c = (Array.isArray(h.clients) ? h.clients[0] : h.clients) as { display_name: string; tax_id: string | null; address: string | null } | null;
      return { name: c?.display_name ?? "—", taxId: c?.tax_id ?? null, address: c?.address ?? null };
    }),
  };
}
export type LoadedQuote = NonNullable<Awaited<ReturnType<typeof loadQuoteVersion>>>;

export async function quotePdfData(_supabase: Supa, q: LoadedQuote): Promise<QuotePdfData> {
  // Dades públiques de l'empresa (també per al PDF que descarrega el client, que no pot llegir la configuració)
  const { data: c } = await createAdminClient().from("company_settings")
    .select("legal_name, tax_id, address, phone, email, website, quote_conditions_ca, quote_conditions_es").maybeSingle();
  const L = q.version.locale as AppLocale;
  return {
    company: { legalName: c?.legal_name ?? "MODULARDOM", taxId: c?.tax_id ?? null, address: c?.address ?? null, phone: c?.phone ?? null, email: c?.email ?? null, website: c?.website ?? null },
    holders: q.holders,
    project: { title: q.project.title, code: q.project.code, address: [q.project.plot_address, q.project.municipality].filter(Boolean).join(", ") || null },
    quote: {
      code: q.quote.code, version: q.version.version,
      issueDate: q.version.issue_date ? formatDate(q.version.issue_date, L) : null,
      validUntil: q.version.valid_until ? formatDate(q.version.valid_until, L) : null,
      intro: q.version.intro, notes: q.version.notes, draft: q.version.status === "esborrany",
      exclusions: q.version.exclusions, paymentTerms: q.version.payment_terms,
      conditions: (L === "es" ? c?.quote_conditions_es : c?.quote_conditions_ca) ?? null,
    },
    lines: q.lines,
  };
}
