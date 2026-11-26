// Contracte del cos de POST /api/web/leads (el document de referència és docs/crm-integration.md
// del repositori modulardom-web). Qualsevol camp desconegut es rebutja.
import { z } from "zod";

const line = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), "control_chars");
const optionalLine = (max: number) => line(max).nullable();


export const configuratorInputSchema = z.strictObject({
  metres: z.number().int().min(1).max(2000),
  habitacions: z.number().int().min(0).max(20),
  banys: z.number().int().min(0).max(20),
  suite: z.enum(["sin", "bano", "bano_vestidor"]),
  cuina: z.enum(["basica", "isla"]),
  vehicles: z.number().int().min(0).max(10),
  safareig: z.boolean(),
  installacions: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)).max(20),
  extres: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)).max(20),
  // afegits amb les cobertes; una configuració antiga no els porta
  plantes: z.union([z.literal(1), z.literal(2)]).optional(),
  coberta: z.enum(["plana", "inclinada", "dues_aigues"]).optional(),
  coberta_m2: z.number().positive().max(5000).optional(),
});

export const configuratorVisualSchema = z.strictObject({
  floors: z.union([z.literal(1), z.literal(2)]),
  system: z.enum(["cellular", "timber"]),
  facade: z.enum(["mineral", "wood"]),
  roof: z.enum(["flat", "mono", "gable", "green"]), // "green" només en configuracions antigues
  volume: z.enum(["compact", "L"]),
});

export const webLeadSchema = z.strictObject({
  reference: z.string().regex(/^W\d{6}-[A-Z0-9]{4}$/),
  capturedAt: z.iso.datetime(),
  source: z.enum(["web", "configurador"]),
  kind: z.enum(["info", "quote", "visit", "mineral"]),
  page: optionalLine(200),
  client: z.strictObject({
    kind: z.enum(["persona", "empresa"]),
    display_name: line(300).refine((s) => s.length >= 2),
    email: z.string().trim().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    phone: line(40).refine((s) => s.replace(/\D/g, "").length >= 9, "phone_digits").nullable(),
    locale: z.enum(["ca", "es"]),
    city: optionalLine(120),
  }),
  project: z.strictObject({
    municipality: optionalLine(120),
    plot_address: optionalLine(300),
    surface_m2: z.number().positive().max(100000).nullable(),
  }),
  configurator: z
    .strictObject({
      input: configuratorInputSchema,
      visual: configuratorVisualSchema.nullable(),
      tariff: z.string().regex(/^[\w.-]{1,20}$/).nullable(),
      totalCents: z.number().int().min(0).max(100_000_000_00).nullable(),
    })
    .nullable(),
  notes: z.string().max(4000),
  // pseudònim del visitant (HMAC de la seva adreça, calculat per la web): només per al límit de peticions; no es desa
  visitor: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

export type WebLead = z.infer<typeof webLeadSchema>;

// ---------------------------------------------------------------------------------------------
// Pressupost orientatiu descarregat des del configurador (POST /api/web/quotes)
// ---------------------------------------------------------------------------------------------
const byLang = z.strictObject({ ca: z.string().max(200), es: z.string().max(200) });
const cents = z.number().int().min(0).max(100_000_000_00);

export const webQuoteSchema = z.strictObject({
  tariff: z.string().regex(/^[\w.-]{1,20}$/),
  requestId: z.string().regex(/^[0-9a-f-]{16,64}$/),
  locale: z.enum(["ca", "es"]),
  lines: z.array(z.strictObject({
    key: z.string().regex(/^[a-zA-Z][\w:]{0,60}$/), label: byLang, detail: byLang.optional(), amountCents: cents, pending: z.boolean().optional(),
  })).min(1).max(40),
  roof: z.strictObject({ type: z.enum(["inclinada", "dues_aigues"]), areaM2: z.number().min(0).max(5000), estimated: z.boolean(), priced: z.boolean() }).nullable(),
  subtotalCents: cents, vatWorksCents: cents, vatArchitectCents: cents,
  vatWorksPct: z.number().min(0).max(100), vatArchitectPct: z.number().min(0).max(100),
  totalCents: cents, hasPending: z.boolean(),
  plot: z.enum(["yes", "no", "searching"]).nullable(),
});

export const webQuoteRequestSchema = z.strictObject({
  lead: webLeadSchema.refine((l) => l.kind === "quote" && l.configurator !== null, "quote_with_configuration"),
  quote: webQuoteSchema,
}).refine((b) => b.quote.subtotalCents + b.quote.vatWorksCents + b.quote.vatArchitectCents === b.quote.totalCents
  && b.quote.lines.reduce((s, l) => s + l.amountCents, 0) === b.quote.subtotalCents, "totals");

export const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
