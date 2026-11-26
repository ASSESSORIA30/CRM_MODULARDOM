// Formulari de tarifa ↔ paràmetres (camps pla "a.b" i files d'instal·lacions/extres).
import type { TariffParams } from "./engine";

export const SCALAR_FIELDS = [
  "construccio_m2", "fonamentacio_m2", "arquitecte_m2", "arquitecte_fix", "escomeses", "metres_minims", "iva_obra_pct", "iva_arquitecte_pct",
  "distribucio_descompte_pct", "intern.habitacio", "intern.bany", "intern.safareig", "intern.suite_bany", "intern.suite_bany_vestidor",
  "garatge.primer_vehicle", "garatge.vehicle_addicional", "garatge.max_vehicles", "cuina.basica", "cuina.illa",
] as const;

/** Camps del bloc de cobertes inclinades. Si es deixen tots en blanc, la tarifa no en porta. */
export const ROOF_FIELDS = [
  "coberta.inclinada.preu_m2", "coberta.inclinada.pendent_pct", "coberta.dues_aigues.preu_m2", "coberta.dues_aigues.pendent_pct", "coberta.volada_m", "coberta.proporcio",
] as const;

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  return s === "" ? NaN : Number(s);
};
const list = (v: FormDataEntryValue | null) => String(v ?? "").split(/[,\s]+/).filter(Boolean).map(Number);

export function getPath(p: TariffParams, path: string): number {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], p) as number;
}

/** Llegeix el formulari i retorna l'objecte de paràmetres (encara sense validar). */
export function paramsFromForm(f: FormData): unknown {
  const out: Record<string, unknown> = { intern: {}, garatge: {}, cuina: {}, installacions_m2: {}, extres: {}, opcions: {} };
  for (const path of SCALAR_FIELDS) {
    const [a, b] = path.split(".");
    if (b) (out[a] as Record<string, number>)[b] = num(f.get(path)); else out[a] = num(f.get(path));
  }
  for (const group of ["installacions_m2", "extres"] as const) {
    const keys = f.getAll(`${group}.key`).map(String);
    keys.forEach((k, i) => {
      const key = k.trim();
      if (!key || f.getAll(`${group}.remove`).map(String).includes(key)) return;
      const nom = { ca: String(f.getAll(`${group}.nom_ca`)[i] ?? "").trim(), es: String(f.getAll(`${group}.nom_es`)[i] ?? "").trim() };
      const price = num(f.getAll(`${group}.preu`)[i] ?? null);
      (out[group] as Record<string, unknown>)[key] = group === "extres" ? { nom, preu: price } : { nom, preu_m2: price };
    });
  }
  // cobertes: tot en blanc = sense bloc; si se n'omple algun, calen tots (ho valida l'esquema)
  if (ROOF_FIELDS.some((k) => String(f.get(k) ?? "").trim() !== "")) {
    const v = (k: (typeof ROOF_FIELDS)[number]) => num(f.get(k));
    out.coberta = {
      inclinada: { preu_m2: v("coberta.inclinada.preu_m2"), pendent_pct: v("coberta.inclinada.pendent_pct") },
      dues_aigues: { preu_m2: v("coberta.dues_aigues.preu_m2"), pendent_pct: v("coberta.dues_aigues.pendent_pct") },
      volada_m: v("coberta.volada_m"), proporcio: v("coberta.proporcio"),
    };
  }
  out.opcions = { habitacions: list(f.get("opcions.habitacions")), banys: list(f.get("opcions.banys")) };
  return out;
}
