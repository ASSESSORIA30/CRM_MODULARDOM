// Formulari de tarifa ↔ paràmetres (camps pla "a.b" i files d'instal·lacions/extres).
import type { TariffParams } from "./engine";

export const SCALAR_FIELDS = [
  "construccio_m2", "fonamentacio_m2", "arquitecte_m2", "arquitecte_fix", "escomeses", "metres_minims", "iva_obra_pct", "iva_arquitecte_pct",
  "distribucio_descompte_pct", "intern.habitacio", "intern.bany", "intern.safareig", "intern.suite_bany", "intern.suite_bany_vestidor",
  "garatge.primer_vehicle", "garatge.vehicle_addicional", "garatge.max_vehicles", "cuina.basica", "cuina.illa",
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
  out.opcions = { habitacions: list(f.get("opcions.habitacions")), banys: list(f.get("opcions.banys")) };
  return out;
}
