import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { decideInvoiceRule, learnInvoiceRule, listInvoiceRules } from "@/server/invoice-rules";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";

/** Regles apreses del lector de factures (Comparatives IA). */
export const GET = handler(async (): Promise<unknown> => {
  const u = await requireInternal();
  return await listInvoiceRules(u);
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("learn"), rule: z.unknown() }),
  z.object({ action: z.enum(["approve", "revoke"]), id: z.string().uuid() }),
]);
export const POST = handler(async (req): Promise<unknown> => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  if (p.data.action === "learn") return await learnInvoiceRule(u, p.data.rule);
  return { rule: await decideInvoiceRule(u, p.data.id, p.data.action === "approve") };
});
