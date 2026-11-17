/* ============================================================
   ModularDom · Configuració de preus  (v4 · integrada amb el CRM)
   ------------------------------------------------------------
   Els preus i les regles ja NO s'editen aquí ni a admin.html:
   es gestionen al CRM (Administració › Tarifes) i es publiquen
   a la web amb una acció autoritzada de direcció.

   · assets/motor.js ........ motor de càlcul (el mateix del CRM)
   · CRM /api/configurador/tarifa.js ... tarifa publicada
   · TARIFA_RESERVA ......... còpia per si el CRM no respon

   IVA: obra i extres 10%; honoraris d'arquitecte 21%.
   Honoraris d'arquitecte: 130 €/m² + 1.800 € (decisió 17/11/2026).
   ============================================================ */

// Tarifa 1 del CRM (17/11/2026). Només s'usa si no arriba la tarifa publicada.
const TARIFA_RESERVA = {
  "construccio_m2": 993,
  "fonamentacio_m2": 120,
  "arquitecte_m2": 130,
  "arquitecte_fix": 1800,
  "escomeses": 3500,
  "metres_minims": 100,
  "iva_obra_pct": 10,
  "iva_arquitecte_pct": 21,
  "intern": {
    "habitacio": 6500,
    "bany": 7500,
    "safareig": 4500,
    "suite_bany": 9800,
    "suite_bany_vestidor": 14500
  },
  "distribucio_descompte_pct": 50,
  "garatge": {
    "primer_vehicle": 20000,
    "vehicle_addicional": 15000,
    "max_vehicles": 4
  },
  "cuina": {
    "basica": 4500,
    "illa": 10000
  },
  "installacions_m2": {
    "aerotermia": {
      "nom": {
        "ca": "Aerotèrmia",
        "es": "Aerotermia"
      },
      "preu_m2": 140
    },
    "aireConductos": {
      "nom": {
        "ca": "Aire conductes",
        "es": "Aire por conductos"
      },
      "preu_m2": 70
    }
  },
  "extres": {
    "piscina": {
      "nom": {
        "ca": "Piscina",
        "es": "Piscina"
      },
      "preu": 22000
    },
    "porche": {
      "nom": {
        "ca": "Porxo",
        "es": "Porche"
      },
      "preu": 8000
    },
    "placasSolares": {
      "nom": {
        "ca": "Plaques solars",
        "es": "Placas solares"
      },
      "preu": 6500
    }
  },
  "opcions": {
    "habitacions": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "banys": [
      1,
      2,
      3,
      4
    ]
  }
};

const IMG_INSTAL = { aerotermia: 'assets/aerotermia.jpg', aireConductos: 'assets/extra-aire-conductos.jpg' };
const IMG_EXTRA = { piscina: 'assets/extra-piscina.jpg', porche: 'assets/extra-porche.jpg', placasSolares: 'assets/placas-solares.jpg' };

// Paràmetres de la tarifa per al motor (window.MODULARDOM_TARIFA arriba del CRM)
function tarifaActiva() {
  const t = window.MODULARDOM_TARIFA;
  return (t && t.params) ? t.params : TARIFA_RESERVA;
}

// Estructura que fa servir la interfície (app.js): noms, imatges i opcions, a partir de la tarifa
function cargarPrecios() {
  const p = tarifaActiva();
  const lang = localStorage.getItem('modulardom_lang') || 'ca';
  const nom = n => (n && (n[lang] || n.ca)) || '';
  const extras_m2 = {}, extras = {};
  Object.keys(p.installacions_m2).forEach(k => { extras_m2[k] = { nombre: nom(p.installacions_m2[k].nom), precio_m2: p.installacions_m2[k].preu_m2, img: IMG_INSTAL[k] || 'assets/aerotermia.jpg' }; });
  Object.keys(p.extres).forEach(k => { extras[k] = { nombre: nom(p.extres[k].nom), precio: p.extres[k].preu, img: IMG_EXTRA[k] || 'assets/extra-porche.jpg' }; });
  return {
    tarifa: p,
    metros_minimos: p.metres_minims,
    iva_obra: p.iva_obra_pct,
    iva_arquitecto: p.iva_arquitecte_pct,
    garaje: { max: p.garatge.max_vehicles },
    extras_m2, extras
  };
}

/* ============================================================
   ENVIAMENT DE LEADS PER EMAIL  (opcional · veure README.txt)
   ============================================================ */
// window.MODULARDOM_EMAIL    = 'info@modulardom.com';   // Opció A · FormSubmit
// window.MODULARDOM_ENDPOINT = 'enviar.php';            // Opció B · script propi
