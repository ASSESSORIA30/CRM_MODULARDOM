/* ModularDom · motor de càlcul del configurador (generat des del CRM; no editar a mà) */
"use strict";
(() => {
  // src/lib/configurator/engine.ts
  var LBL = {
    construccio: { ca: "Construcci\xF3", es: "Construcci\xF3n" },
    arquitecte: { ca: "Honoraris d'arquitecte", es: "Honorarios de arquitecto" },
    fonamentacio: { ca: "Fonamentaci\xF3", es: "Cimentaci\xF3n" },
    escomeses: { ca: "Acometides i sanejament", es: "Acometidas y saneamiento" },
    distribucio: { ca: "Distribuci\xF3 interior personalitzada", es: "Distribuci\xF3n interior personalizada" },
    cuina: { ca: "Cuina", es: "Cocina" },
    installacions: { ca: "Instal\xB7lacions", es: "Instalaciones" }
  };
  var KITCHEN_LABEL = {
    basica: { ca: "Cuina b\xE0sica", es: "Cocina b\xE1sica" },
    isla: { ca: "Cuina amb illa", es: "Cocina con isla" }
  };
  var garageLabel = (n) => n === 1 ? { ca: "Garatge (1 vehicle)", es: "Garaje (1 veh\xEDculo)" } : { ca: `Garatge (${n} vehicles)`, es: `Garaje (${n} veh\xEDculos)` };
  var eur = (e) => Math.round(e * 100);
  var pct = (cents, p) => Math.round(cents * Math.round(p * 100) / 1e4);
  function validateInput(p, c) {
    const e = [];
    if (!Number.isInteger(c.metres) || c.metres < p.metres_minims) e.push({ field: "metres", code: "min" });
    if (!p.opcions.habitacions.includes(c.habitacions)) e.push({ field: "habitacions", code: "option" });
    if (!p.opcions.banys.includes(c.banys)) e.push({ field: "banys", code: "option" });
    if (!["sin", "bano", "bano_vestidor"].includes(c.suite)) e.push({ field: "suite", code: "option" });
    if (!["basica", "isla"].includes(c.cuina)) e.push({ field: "cuina", code: "option" });
    if (!Number.isInteger(c.vehicles) || c.vehicles < 0 || c.vehicles > p.garatge.max_vehicles) e.push({ field: "vehicles", code: "option" });
    for (const k of c.installacions) if (!p.installacions_m2[k]) e.push({ field: "installacions", code: "unknown" });
    for (const k of c.extres) if (!p.extres[k]) e.push({ field: "extres", code: "unknown" });
    return e;
  }
  function calculate(p, c) {
    const m = c.metres;
    const lines = [];
    const internal = {
      habitacions: c.habitacions * eur(p.intern.habitacio),
      banys: c.banys * eur(p.intern.bany),
      suite: c.suite === "bano" ? eur(p.intern.suite_bany) : c.suite === "bano_vestidor" ? eur(p.intern.suite_bany_vestidor) : 0,
      safareig: c.safareig ? eur(p.intern.safareig) : 0
    };
    if (m > 0) {
      lines.push({ key: "construccio", label: LBL.construccio, amountCents: m * eur(p.construccio_m2), vat: "obra", quantity: m, unitPriceCents: eur(p.construccio_m2) });
      lines.push({ key: "arquitecte", label: LBL.arquitecte, amountCents: m * eur(p.arquitecte_m2) + eur(p.arquitecte_fix), vat: "arquitectura" });
      lines.push({ key: "fonamentacio", label: LBL.fonamentacio, amountCents: m * eur(p.fonamentacio_m2), vat: "obra", quantity: m, unitPriceCents: eur(p.fonamentacio_m2) });
      lines.push({ key: "escomeses", label: LBL.escomeses, amountCents: eur(p.escomeses), vat: "obra" });
    }
    const distOriginal = internal.habitacions + internal.banys + internal.suite + internal.safareig;
    if (distOriginal > 0) {
      lines.push({
        key: "distribucio",
        label: LBL.distribucio,
        originalCents: distOriginal,
        discountPct: p.distribucio_descompte_pct,
        amountCents: distOriginal - pct(distOriginal, p.distribucio_descompte_pct),
        vat: "obra"
      });
    }
    const kitchen = c.cuina === "isla" ? eur(p.cuina.illa) : c.cuina === "basica" ? eur(p.cuina.basica) : 0;
    if (kitchen > 0) lines.push({ key: "cuina", label: LBL.cuina, amountCents: kitchen, vat: "obra", detail: KITCHEN_LABEL[c.cuina] });
    const inst = c.installacions.filter((k) => p.installacions_m2[k]);
    const instCents = inst.reduce((s, k) => s + m * eur(p.installacions_m2[k].preu_m2), 0);
    if (instCents > 0) {
      lines.push({
        key: "installacions",
        label: LBL.installacions,
        amountCents: instCents,
        vat: "obra",
        detail: { ca: inst.map((k) => p.installacions_m2[k].nom.ca).join(", "), es: inst.map((k) => p.installacions_m2[k].nom.es).join(", ") }
      });
    }
    const garage = c.vehicles ? eur(p.garatge.primer_vehicle) + (c.vehicles - 1) * eur(p.garatge.vehicle_addicional) : 0;
    if (garage > 0) lines.push({ key: "garatge", label: garageLabel(c.vehicles), amountCents: garage, vat: "obra" });
    for (const k of c.extres) {
      if (p.extres[k]) lines.push({ key: `extra:${k}`, label: p.extres[k].nom, amountCents: eur(p.extres[k].preu), vat: "obra" });
    }
    const baseArqCents = lines.filter((l) => l.vat === "arquitectura").reduce((s, l) => s + l.amountCents, 0);
    const baseObraCents = lines.filter((l) => l.vat === "obra").reduce((s, l) => s + l.amountCents, 0);
    const ivaObraCents = pct(baseObraCents, p.iva_obra_pct);
    const ivaArqCents = pct(baseArqCents, p.iva_arquitecte_pct);
    const subtotalCents = baseObraCents + baseArqCents;
    return { lines, baseObraCents, baseArqCents, subtotalCents, ivaObraCents, ivaArqCents, totalCents: subtotalCents + ivaObraCents + ivaArqCents, internal };
  }

  // src/lib/configurator/web-entry.ts
  window.ModulardomMotor = { version: 1, calculate, validateInput };
})();
