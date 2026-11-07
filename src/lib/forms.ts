// Utilitats de validació de formularis (Zod) per a Server Actions.
import { z } from "zod";
import { parseEurosToCents } from "@/lib/money";
import { isValidDateKey, madridLocalToDate } from "@/lib/dates";

export const optText = (max = 2000) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
    z.string().max(max).nullable().optional());

export const reqText = (max = 300) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, "required").max(max));

export const optUuid = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().uuid().nullable());
export const reqUuid = z.string().uuid();

export const optEmail = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email("invalidEmail").max(200).nullable().optional());

export const optDateKey = z.preprocess((v) => (v === "" || v == null ? null : v),
  z.string().refine(isValidDateKey, "invalidDate").nullable());

export const optCents = z.preprocess((v, ctx) => {
  try {
    return parseEurosToCents(typeof v === "string" ? v : null);
  } catch {
    ctx.addIssue({ code: "custom", message: "invalidAmount" });
    return z.NEVER;
  }
}, z.number().int().nonnegative("invalidAmount").nullable());

export const optPositiveNumber = z.preprocess((v) => {
  if (typeof v !== "string" || v.trim() === "") return null;
  return Number(v.replace(/\./g, "").replace(",", "."));
}, z.number().positive("invalidAmount").max(100000).nullable());

/** Data/hora d'un input datetime-local interpretada en hora de Madrid. */
export const madridDateTime = z.string().transform((v, ctx) => {
  try {
    return madridLocalToDate(v).toISOString();
  } catch {
    ctx.addIssue({ code: "custom", message: "invalidDate" });
    return z.NEVER;
  }
});

export function formObject(formData: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "_")] = issue.message;
  return out;
}
