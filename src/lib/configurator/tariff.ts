// Esquema i validació de la tarifa del configurador. La tarifa inicial és la de la web
// (assets/config.js · PRECIOS_DEFECTO, v3) amb els honoraris d'arquitecte decidits per direcció.
import { z } from "zod";
import type { TariffParams } from "./engine";

const money = z.number().min(0).max(10_000_000).refine((v) => Math.round(v * 100) === v * 100, "max2dec");
const byLang = z.object({ ca: z.string().trim().min(1).max(80), es: z.string().trim().min(1).max(80) });
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/);

export const tariffSchema = z.object({
  construccio_m2: money,
  fonamentacio_m2: money,
  arquitecte_m2: money,
  arquitecte_fix: money,
  escomeses: money,
  metres_minims: z.number().int().min(1).max(10000),
  iva_obra_pct: z.number().min(0).max(100),
  iva_arquitecte_pct: z.number().min(0).max(100),
  intern: z.object({ habitacio: money, bany: money, safareig: money, suite_bany: money, suite_bany_vestidor: money }),
  distribucio_descompte_pct: z.number().min(0).max(100),
  garatge: z.object({ primer_vehicle: money, vehicle_addicional: money, max_vehicles: z.number().int().min(0).max(10) }),
  cuina: z.object({ basica: money, illa: money }),
  installacions_m2: z.record(key, z.object({ nom: byLang, preu_m2: money })),
  extres: z.record(key, z.object({ nom: byLang, preu: money })),
  opcions: z.object({ habitacions: z.array(z.number().int().min(0).max(20)).min(1), banys: z.array(z.number().int().min(0).max(20)).min(1) }),
}) satisfies z.ZodType<TariffParams>;

/** Tarifa de www.modulardom.com/presupuesto (config.js v3, 17/11/2026). */
export const WEB_TARIFF_V3: TariffParams = {
  construccio_m2: 993,
  fonamentacio_m2: 120,
  arquitecte_m2: 130,
  arquitecte_fix: 1800,
  escomeses: 3500,
  metres_minims: 100,
  iva_obra_pct: 10,
  iva_arquitecte_pct: 21,
  intern: { habitacio: 6500, bany: 7500, safareig: 4500, suite_bany: 9800, suite_bany_vestidor: 14500 },
  distribucio_descompte_pct: 50,
  garatge: { primer_vehicle: 20000, vehicle_addicional: 15000, max_vehicles: 4 },
  cuina: { basica: 4500, illa: 10000 },
  installacions_m2: {
    aerotermia: { nom: { ca: "Aerotèrmia", es: "Aerotermia" }, preu_m2: 140 },
    aireConductos: { nom: { ca: "Aire conductes", es: "Aire por conductos" }, preu_m2: 70 },
  },
  extres: {
    piscina: { nom: { ca: "Piscina", es: "Piscina" }, preu: 22000 },
    porche: { nom: { ca: "Porxo", es: "Porche" }, preu: 8000 },
    placasSolares: { nom: { ca: "Plaques solars", es: "Placas solares" }, preu: 6500 },
  },
  opcions: { habitacions: [1, 2, 3, 4, 5, 6], banys: [1, 2, 3, 4] },
};

/** Diferències entre dues tarifes (per a l'historial: camp, valor anterior, valor nou). */
export function tariffDiff(a: unknown, b: unknown, path = ""): { path: string; before: unknown; after: unknown }[] {
  if (typeof a === "object" && a && typeof b === "object" && b && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].sort().flatMap((k) => tariffDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, before: a ?? null, after: b ?? null }];
}
