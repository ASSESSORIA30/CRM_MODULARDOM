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
  var ROOF_LABEL = {
    inclinada: { ca: "Coberta inclinada d'una aigua", es: "Cubierta inclinada a un agua" },
    dues_aigues: { ca: "Coberta a dues aig\xFCes", es: "Cubierta a dos aguas" }
  };
  var m2Text = (a) => a.toFixed(1).replace(".", ",");
  function estimateRoofArea(metres, plantes, pendentPct, voladaM, proporcio) {
    const footprint = metres / plantes;
    const length = Math.sqrt(footprint * proporcio);
    const width = footprint / length;
    const plan = (length + 2 * voladaM) * (width + 2 * voladaM);
    return Math.round(plan * Math.sqrt(1 + (pendentPct / 100) ** 2) * 10) / 10;
  }
  function roofParamsValid(r) {
    const ok = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
    return !!r && [r.inclinada, r.dues_aigues].every((x) => !!x && ok(x.preu_m2, 0, 1e4) && ok(x.pendent_pct, 1, 100)) && ok(r.volada_m, 0, 3) && ok(r.proporcio, 1, 4);
  }
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
    if (c.plantes !== void 0 && c.plantes !== 1 && c.plantes !== 2) e.push({ field: "plantes", code: "option" });
    if (c.coberta !== void 0 && !["plana", "inclinada", "dues_aigues"].includes(c.coberta)) e.push({ field: "coberta", code: "option" });
    if (c.coberta_m2 !== void 0 && !(typeof c.coberta_m2 === "number" && c.coberta_m2 > 0 && c.coberta_m2 <= 5e3)) e.push({ field: "coberta_m2", code: "range" });
    return e;
  }
  function calculate(p, c) {
    var _a;
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
    let roof;
    if (c.coberta === "inclinada" || c.coberta === "dues_aigues") {
      const label = ROOF_LABEL[c.coberta];
      if (roofParamsValid(p.coberta)) {
        const rp = p.coberta[c.coberta];
        const estimated = c.coberta_m2 === void 0;
        const area = estimated ? estimateRoofArea(m, (_a = c.plantes) != null ? _a : 1, rp.pendent_pct, p.coberta.volada_m, p.coberta.proporcio) : Math.round(c.coberta_m2 * 10) / 10;
        roof = { type: c.coberta, areaM2: area, estimated, priced: true };
        lines.push({
          key: "coberta",
          label,
          amountCents: Math.round(area * eur(rp.preu_m2)),
          vat: "obra",
          quantity: area,
          unitPriceCents: eur(rp.preu_m2),
          detail: estimated ? { ca: `${m2Text(area)} m\xB2 de coberta (superf\xEDcie estimada)`, es: `${m2Text(area)} m\xB2 de cubierta (superficie estimada)` } : { ca: `${m2Text(area)} m\xB2 de coberta (superf\xEDcie mesurada)`, es: `${m2Text(area)} m\xB2 de cubierta (superficie medida)` }
        });
      } else {
        roof = { type: c.coberta, areaM2: 0, estimated: true, priced: false };
        lines.push({ key: "coberta", label, amountCents: 0, vat: "obra", pending: true });
      }
    }
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
    return { lines, baseObraCents, baseArqCents, subtotalCents, ivaObraCents, ivaArqCents, totalCents: subtotalCents + ivaObraCents + ivaArqCents, internal, ...roof ? { roof } : {}, pending: lines.filter((l) => l.pending).map((l) => l.key) };
  }

  // src/lib/configurator/web-entry.ts
  window.ModulardomMotor = { version: 1, calculate, validateInput };
})();
