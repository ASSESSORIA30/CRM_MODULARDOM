/* ============================================================
   ModularDom · Configuració de preus  (v3 · preus oficials)
   ------------------------------------------------------------
   Editables des d'admin.html (es guarden al navegador) o aquí
   per fixar-los permanentment per a tots els visitants.

   IVA: obra i extres 10%; honoraris d'arquitecte 21%.
   El preu fix (2.800 €) se suma DINS de l'arquitecte.

   Costos INTERNS (habitacions/banys/suite/lavadero): MAI es
   mostren desglossats. S'acumulen dins "Distribució interior
   personalitzada".
   ============================================================ */

const PRECIOS_DEFECTO = {
  // --- Partides visibles ---
  construccion_m2: 993,        // €/m² vivenda acabada
  cimentacion_m2: 120,         // €/m²
  // Arquitecte = (arquitecto_m2 × m²) + arquitecto_fijo + precio_fijo.
  // La fórmula NO es mostra; el client només veu l'import final. IVA 21%.
  arquitecto_m2: 130,          // €/m²
  arquitecto_fijo: 1800,       // € import fix d'arquitectura
  precio_fijo: 2800,           // € preu fix (se suma dins l'arquitecte)
  acometidas_base: 3500,       // € acometides i sanejament
  metros_minimos: 100,         // m² mínims (entrada manual)

  // --- IVA ---
  iva_obra: 10,                // % obra i extres
  iva_arquitecto: 21,          // % honoraris d'arquitecte

  // --- Cost INTERN de distribució (MAI desglossat) ---
  interno: {
    habitacion: 6500,             // € per habitació
    bano: 7500,                   // € per bany
    lavadero: 4500,               // € safareig / lavadero
    suite_bano: 9800,             // € suite amb bany
    suite_bano_vestidor: 14500    // € suite amb bany i vestidor
  },

  // --- Garatge: per nombre de vehicles ---
  garaje: {
    primer_vehiculo: 20000,    // € el primer cotxe
    vehiculo_extra: 15000      // € cada cotxe addicional
  },

  // --- Cuina: opcions amb render diferent ---
  cocina: {
    basica: 4500,              // € cuina bàsica (sense electrodomèstics)
    isla: 10000                // € cuina amb illa (sense electrodomèstics)
  },

  // --- Instal·lacions per m² (tarja seleccionable amb foto) ---
  extras_m2: {
    aerotermia:    { nombre: 'Aerotèrmia',       precio_m2: 140, img:'assets/aerotermia.jpg' },
    aireConductos: { nombre: 'Aire conductes',   precio_m2: 70,  img:'assets/extra-aire-conductos.jpg' }
  },

  // --- Extres a preu fix (tarja seleccionable amb foto) ---
  extras: {
    piscina:       { nombre: 'Piscina',        precio: 22000, img:'assets/extra-piscina.jpg' },
    porche:        { nombre: 'Porxo',          precio: 8000,  img:'assets/extra-porche.jpg' },
    placasSolares: { nombre: 'Plaques solars', precio: 6500,  img:'assets/placas-solares.jpg' }
  }
};

function cargarPrecios() {
  try {
    const guardado = localStorage.getItem('modulardom_precios');
    if (!guardado) return structuredClone(PRECIOS_DEFECTO);
    const g = JSON.parse(guardado);
    const base = structuredClone(PRECIOS_DEFECTO);
    Object.assign(base, g);
    base.interno   = Object.assign(structuredClone(PRECIOS_DEFECTO.interno),   g.interno   || {});
    base.garaje    = Object.assign(structuredClone(PRECIOS_DEFECTO.garaje),    g.garaje    || {});
    base.cocina    = Object.assign(structuredClone(PRECIOS_DEFECTO.cocina),    g.cocina    || {});
    base.extras_m2 = Object.assign(structuredClone(PRECIOS_DEFECTO.extras_m2), g.extras_m2 || {});
    base.extras    = Object.assign(structuredClone(PRECIOS_DEFECTO.extras),    g.extras    || {});
    const extrasBloqueados = ['garaje','garatge','garage','domotica','domotica','cocina premium','cuina premium','cocina premuim','cuina premuim','premium kitchen','aerotermia','aerotèrmia','aire conductes','aire acondicionado conductos'];
    Object.keys(base.extras).forEach(k => {
      const nombre = String(base.extras[k]?.nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const clave = String(k || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if (extrasBloqueados.some(x => clave.includes(x) || nombre.includes(x))) delete base.extras[k];
    });
    if (base.extras.piscina) base.extras.piscina.img = 'assets/extra-piscina.jpg';
    if (base.extras.porche) base.extras.porche.img = 'assets/extra-porche.jpg';
    if (base.extras.placasSolares) base.extras.placasSolares.img = 'assets/placas-solares.jpg';
    if (base.extras_m2.aerotermia) base.extras_m2.aerotermia.img = 'assets/aerotermia.jpg';
    if (base.extras_m2.aireConductos) base.extras_m2.aireConductos.img = 'assets/extra-aire-conductos.jpg';
    return base;
  } catch (e) {
    return structuredClone(PRECIOS_DEFECTO);
  }
}

/* ============================================================
   ENVIAMENT DE LEADS PER EMAIL  (opcional · veure README.txt)
   ============================================================ */
// window.MODULARDOM_EMAIL    = 'info@modulardom.com';   // Opció A · FormSubmit
// window.MODULARDOM_ENDPOINT = 'enviar.php';            // Opció B · script propi
