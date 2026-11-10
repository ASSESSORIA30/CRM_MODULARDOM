# FASE 2 — Pressupostos i contractes

Migració: `supabase/migrations/20261109001000_pressupostos_contractes.sql`.
Proves: `supabase/tests/06_pressupostos_contractes_test.sql`, `src/lib/quotes/*.test.ts`,
`src/lib/contracts/*.test.ts`, `tests/e2e/test_quote_editor.py`, `scripts/check-columns.sh`.

## Configuració (només direcció)
| Taula | Contingut inicial |
|---|---|
| `vat_rates` | 0 %, 4 %, 10 %, 21 % |
| `concept_types` | IVA per defecte: construcció, cimentació, escomeses i extres **10 %**; projecte, direcció i final d'obra **21 %**; "altres" sense IVA per defecte |
| `invoice_series` | Sèrie general `AA-NNN`, any 2026, darrer número **13** (la propera factura serà la 26-014). S'utilitzarà a la FASE 4 |
| `company_settings` | Raó social, telèfon, correu i web del pressupost de referència. **NIF, adreça i IBAN buits: els ha d'introduir direcció** (no s'inventen) |

L'IVA per defecte només proposa un valor: a cada partida del pressupost i a cada fita del contracte es pot canviar.

## Pressupostos
- Rutes: `/pressupostos` (tots), `/projectes/[id]/pressupostos` (del projecte i crear-ne un), `/pressupostos/[versió]`.
- Número correlatiu per any (`P26-001`), versions, origen (manual / configurador / importat / duplicat).
- Partides per tipus — pressupost base, extres inclosos, extres posteriors i descomptes — amb capítol, concepte,
  quantitat (3 decimals), unitat, preu, descompte en % per línia i IVA per partida.
- Imports calculats a la base de dades (columna generada) i al navegador amb la mateixa fórmula i arrodoniment.
  L'IVA s'arrodoneix per tipus, no per línia. Es guarden per separat base, extres inicials, extres posteriors,
  descomptes, base imposable, IVA i total (vista `quote_version_totals`).
- **Immutabilitat:** una versió enviada no es pot modificar (ni les partides). Per fer canvis es crea una versió nova,
  que substitueix l'enviada. Un pressupost acceptat ja no admet versions noves: els canvis van com a extres.
- PDF corporatiu (castellà o català segons el document): titulars, empresa, resum base, extres, totals amb IVA per tipus,
  total clau en mà, acceptació amb signatures, validesa i peu. Es pot descarregar i desar a la documentació (intern).
- El client veu només la versió **acceptada** del seu projecte. L'arquitecte i el constructor no veuen imports.

### Pendent d'aquesta part
- **Importació del configurador web:** cal saber quin format exporta el configurador (JSON, CSV, correu…).
  El model ja té l'origen `configurador` preparat.
- **Importar un pressupost existent** (PDF) amb IA: es pot fer amb el mateix sistema del lector de contractes.
- **Enviar per correu des del CRM:** arribarà amb la integració de correu (FASE 5). Ara es descarrega el PDF.

## Contractes
- Rutes: `/projectes/[id]/contractes` i `/projectes/[id]/contractes/[contracte]`.
- El contracte signat es puja a «Contracte i factures» (PDF, DOCX, JPG o PNG) i es vincula al pressupost acceptat.
- **Lector IA:** envia el PDF complet al model (també escanejats) i obliga a respondre amb un esquema validat:
  titulars, contractista, adreça, referència cadastral, dates, import total, capítols, fases, **cada fita** amb codi,
  concepte, import, condició, pàgina i text literal, extres amb les seves fites pròpies, condicions de pagament,
  terminis, condicions específiques, documents vinculats i modificacions. El que no pot determinar ho declara.
- **El calendari dels extres** és el que fixa el contracte de cada client, per fites. Si un extre no en té,
  la lectura el marca com a no determinable i direcció defineix les fites. Mai s'aplica un 50/30/20 automàtic.
- **Verificació automàtica** (sense IA): suma de capítols i de fites contra el total, suma de cada fase contra el seu
  import, fases sense fites, codis i fites duplicades, imports amb format anòmal, imports que **no apareixen escrits a
  la pàgina indicada** (si el PDF té text), contracte contra pressupost acceptat, extres contra pressupost, data de
  signatura absent i IVA no determinable.
- **Validació humana:** acceptar, corregir, reordenar, afegir, eliminar, fusionar i dividir fites; confirmar imports
  i IVA; resoldre cada discrepància amb una explicació obligatòria. `validate_contract()` exigeix total confirmat,
  totes les fites confirmades amb IVA, cap discrepància oberta i suma de fites = total. Un cop validat, res no es pot
  modificar i les fites queden activades per a la facturació (FASE 4).
- Es conserven el document original, cada lectura de la IA tal com va arribar (`contract_extractions`, immutable)
  i totes les correccions (registre d'auditoria).
- Sense `ANTHROPIC_API_KEY` el flux funciona igual introduint les fites a mà.

### Cas de referència (anonimitzat)
Sobre les 37 fites verificades a mà, la verificació detecta: la diferència de 300 € amb el pressupost (direcció l'ha
confirmada com a error de càlcul i la marcarà com a ignorada amb aquesta explicació), els 3 extres sense fites
(33.050 €), l'import mal escrit de F2 i la data de signatura en blanc. Les 37 quantitats es troben escrites a les
pàgines de l'annex del contracte real (prova local, sense incloure el contracte al repositori).

## Límits de temps a Vercel
Llegir un contracte de 50 pàgines pot trigar 1–3 minuts. La pàgina del contracte demana fins a 300 s
(`maxDuration`). Si el pla de Vercel no ho permet, la lectura s'interromprà: caldrà un pla que admeti funcions
més llargues o llegir només el contracte i els annexos econòmics.
