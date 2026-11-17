# Pressupostos v2 — configurador, importació, versions i extres

Migració: `supabase/migrations/20261117001100_pressupostos_v2.sql` (només afegeix; no elimina ni modifica dades).
Proves: `supabase/tests/07_pressupostos_v2_test.sql`, `src/lib/configurator/*.test.ts`, `src/lib/quotes/*.test.ts`,
`tests/e2e/test_web_vs_crm.py`, `tests/e2e/test_configurator_ui.py`, `tests/e2e/test_quote_editor.py`.

## 1. Regles de la web (anàlisi del codi real, v3 rebuda el 17/11/2026)
Font: `assets/config.js` (`PRECIOS_DEFECTO`) i `assets/app.js` (`calcular()`), còpia a `tests/web-reference/original/`.

| Concepte | Regla | IVA |
|---|---|---|
| Construcció | 993 €/m² × m² | 10 % |
| Honoraris d'arquitecte | **130 €/m² × m² + 1.800 €** (vegeu la decisió) | 21 % |
| Fonamentació | 120 €/m² × m² | 10 % |
| Acometides i sanejament | 3.500 € | 10 % |
| Distribució interior personalitzada | (habitacions × 6.500 + banys × 7.500 + suite [amb bany 9.800 / + vestidor 14.500] + safareig 4.500) **− 50 %**; el desglossament intern no es mostra mai al client | 10 % |
| Cuina | bàsica 4.500 € · amb illa 10.000 € | 10 % |
| Instal·lacions | aerotèrmia 140 €/m² · aire per conductes 70 €/m² (una sola línia "Instal·lacions") | 10 % |
| Garatge | 1r vehicle 20.000 € + 15.000 € cada addicional (0–4) | 10 % |
| Extres fixos | piscina 22.000 € · porxo 8.000 € · plaques solars 6.500 € | 10 % |
| Superfície mínima | 100 m² · habitacions 1–6 · banys 1–4 | |

L'IVA d'obra s'aplica a la suma de tot el que no és arquitectura; el d'arquitecte, als honoraris.
El sistema constructiu no té opcions de preu a la web (és un text descriptiu); el CRM tampoc n'hi posa.

**Decisió de direcció (17/11/2026):** a la web hi havia una contradicció. `app.js` sumava als honoraris un "preu fix"
de 2.800 € (i així sortien al PDF i al total del lead), però un pegat de l'`index.html` els treia de la pantalla.
Direcció ha fixat la regla **130 €/m² + 1.800 €**. La prova `test_lead_and_pdf_total_match_screen` demostra
l'error a la web actual (+3.388 € al lead/PDF) i que la web integrada ja no el té.

## 2. Catàleg central i sincronització amb la web
- **Font única de regles:** `src/lib/configurator/engine.ts`. El CRM l'usa directament; per a la web es compila a
  `public/configurador/motor.js` (`npm run build:motor`, també a cada `build`) i se'n desa una còpia idèntica a
  `web-integracio/assets/motor.js` (una prova falla si no coincideixen).
- **Font única de preus:** `tariff_versions` (Supabase). Cada versió és immutable un cop aprovada, té data d'entrada
  en vigor, notes, qui i quan l'ha aprovat, i la diferència camp a camp amb l'anterior (Administració › Tarifes).
  L'auditoria registra qualsevol canvi.
- **Pressupostos ja emesos:** cada versió guarda la tarifa, l'entrada i el resultat del configurador; les partides
  guarden el preu de catàleg. Un canvi de tarifa no toca cap pressupost existent.
- **Publicació a la web:** acció explícita de direcció ("Publicar a la web"), només per a tarifes aprovades i ja en
  vigor. La web llegeix `GET /api/configurador/tarifa.js` (públic, sense dades personals, CORS només per a
  modulardom.com). Si no respon, fa servir la tarifa de reserva de `config.js`.
- **Per què així:** la web és estàtica a IONOS i no pot llegir Supabase amb seguretat; el CRM exposa només la tarifa
  publicada. No hi ha scraping ni regles duplicades: la web i el CRM executen el mateix fitxer de motor.

## 3. Comprovacions de coincidència web ↔ CRM
`tests/e2e/test_web_vs_crm.py` obre la web real en un navegador, hi introdueix 40 configuracions (incloses les
extremes: 100 m², 300 m² amb totes les opcions, metres no rodons) i compara cada línia, la base i els IVA amb el CRM:
- web **actual** (v3): 40/40 iguals en línies i base; IVA i total iguals en euros arrodonits.
- web **integrada** (v4): 40/40 iguals, i amb una tarifa nova publicada la web calcula com el CRM.
- `engine.test.ts`: 200 configuracions convertides en pressupost donen exactament els mateixos totals que el motor.

## 4. Pressupostos
- Al projecte: **Crear pressupost** (configurador) i **Pujar pressupost** (PDF, Excel, Word). També "en blanc".
- Estat de cada partida: **inclosa** (suma), **opcional** (no suma fins que s'accepti), **pendent de valoració**,
  **exclosa** (no surt al PDF). Totals a la base de dades i al navegador amb la mateixa fórmula.
- Preus de catàleg: es poden modificar a l'esborrany, però només **direcció**; queden marcats (✎) i el catàleg no canvia.
- Observacions, **exclusions** i **condicions de pagament** per versió; surten al PDF.
- Versions immutables un cop enviades; comparar versions (afegides, eliminades, modificades i efecte als totals);
  marcar la **vigent**; **publicar al client** (mai un esborrany).
- PDF en català o castellà (tot el document en l'idioma triat), amb logotip, dades fiscals (de la configuració),
  partides, subtotals, IVA per tipus, total, extres opcionals a part, observacions, exclusions, condicions i validesa.

## 5. Importació amb IA
- L'original es desa al bucket privat `pressupostos` amb SHA-256 i no es modifica mai; es pot veure i descarregar.
- Estat declarat del document (esborrany, enviat, aprovat, rebutjat).
- La IA llegeix PDF (també escanejats), Excel (per full i fila) i Word, i retorna cada partida amb l'origen.
- Verificació automàtica: dubtes de la IA, partides sense import, quantitat × preu ≠ import, imports que no apareixen
  al document, IVA no indicat, suma ≠ base declarada. Les partides dubtoses queden **marcades per revisar** i la
  conversió no es permet fins que totes estan revisades.
- La conversió crea un **esborrany editable** vinculat a l'original; després s'envia i genera el seu PDF.

## 6. Extres i control econòmic
Estats: proposat → pendent d'aprovació → **aprovat** / rebutjat → **incorporat** (annex o modificació signada +
fites de cobrament que sumen l'import) → executat → **facturat** → **cobrat**. Cada canvi queda a l'historial amb
data, usuari i nota. Aprovar ≠ facturar ≠ cobrar.
- Acceptació registrada amb data, usuari i via (direcció o el client des del portal, si està habilitat).
- Un extra aprovat no canvia d'import; un extra rebutjat no suma.
- Si una versió posterior del pressupost ja l'inclou, es marca i no es compta dues vegades.
- Cost previst, costos reals (proveïdor, data, import) i marge.
- Resum del projecte: import contractat (contracte validat o pressupost acceptat), extres aprovats, total, pendents,
  facturat, cobrat, costos i marge. La facturació real arriba amb la FASE 4.

## 7. Permisos
| Rol | Pressupostos | Tarifes | Extres |
|---|---|---|---|
| Direcció | Tot | Crear, aprovar, publicar | Tot |
| Arquitecte assignat | Veure i preparar esborranys dels seus projectes (no canvia preus de catàleg, ni envia, ni publica) | Llegir | Veure (sense costos) |
| Constructor | Només partides marcades com a visibles del pressupost vigent/acceptat, sense imports | — | — |
| Client | Només versions publicades del seu projecte; descarregar; acceptar/rebutjar si s'habilita | — | Els que se li presenten; acceptar/rebutjar si s'habilita |

Canvi de comportament: abans el client veia automàticament el pressupost acceptat; ara només veu el que direcció
publica. Els pressupostos acceptats que ja existien s'han marcat com a publicats per no perdre'n la visibilitat.

## 8. Contractes
El pressupost acceptat es vincula al contracte (ja existent) i la verificació el compara amb el contracte. Un
contracte validat no es modifica mai: els canvis posteriors van com a extres amb annex.
