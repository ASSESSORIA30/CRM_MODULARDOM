import { describe, expect, it } from "vitest";
import { getPath, paramsFromForm, SCALAR_FIELDS } from "./tariff-form";
import { tariffSchema, WEB_TARIFF_V3 } from "./tariff";

function formFrom(p: typeof WEB_TARIFF_V3) {
  const f = new FormData();
  for (const k of SCALAR_FIELDS) f.set(k, String(getPath(p, k)).replace(".", ","));
  for (const [g, priceKey] of [["installacions_m2", "preu_m2"], ["extres", "preu"]] as const) {
    for (const [k, v] of Object.entries(p[g] as unknown as Record<string, { nom: { ca: string; es: string }; preu?: number; preu_m2?: number }>)) {
      f.append(`${g}.key`, k); f.append(`${g}.nom_ca`, v.nom.ca); f.append(`${g}.nom_es`, v.nom.es); f.append(`${g}.preu`, String(v[priceKey as "preu"]));
    }
  }
  f.set("opcions.habitacions", p.opcions.habitacions.join(",")); f.set("opcions.banys", p.opcions.banys.join(","));
  return f;
}

describe("formulari de tarifa", () => {
  it("anada i tornada sense pèrdues", () => {
    expect(tariffSchema.parse(paramsFromForm(formFrom(WEB_TARIFF_V3)))).toEqual(WEB_TARIFF_V3);
  });
  it("afegir i treure extres; valors invàlids rebutjats", () => {
    const f = formFrom(WEB_TARIFF_V3);
    f.append("extres.key", "pergola"); f.append("extres.nom_ca", "Pèrgola"); f.append("extres.nom_es", "Pérgola"); f.append("extres.preu", "4.200");
    f.append("extres.remove", "porche");
    const p = tariffSchema.parse(paramsFromForm(f));
    expect(Object.keys(p.extres)).toEqual(["piscina", "placasSolares", "pergola"]);
    expect(p.extres.pergola.preu).toBe(4200);
    f.set("construccio_m2", "-5");
    expect(tariffSchema.safeParse(paramsFromForm(f)).success).toBe(false);
  });
});
