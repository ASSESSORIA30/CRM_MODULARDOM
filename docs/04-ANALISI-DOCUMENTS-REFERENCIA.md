# Anàlisi dels documents de referència

> Document **anonimitzat**: no conté noms, NIE, adreces ni IBAN de clients reals.
> El projecte s'anomena `MD-REF-001` i els titulars, *Titular 1* i *Titular 2*.
> Fites verificades i resultat esperat del lector IA: `tests/fixtures/contracte-referencia.fites.json`.

## 1. Pressupost personalitzat (PDF, 2 pàgines, castellà)

| Bloc | Concepte | Import (sense IVA) |
|---|---|---:|
| Base | Construcció habitatge (260 m² × 993 €/m²) | 258.180 € |
| Base | Cimentació | 36.000 € |
| Base | Escomeses (aigua, llum i sanejament fins a 10 m) | 3.800 € |
| Base | Projecte, direcció i final d'obra | 35.600 € |
| | **Total pressupost base** | **333.580 €** |
| Extres | 10 línies (cuina, garatge, piscina, clima, 2 terrasses, camí, 2 altures, plaques) | 163.000 € |
| | **Total amb extres** | **496.580 €** |

Estructura: dos titulars + empresa, resum base, línia destacada de total "clau en mà", taula d'extres,
bloc d'acceptació amb tres signatures i data, validesa d'1 mes.
Identitat visual: blau marí, daurat, logotip quadrat, peu amb telèfon/email/web.

**Mancances detectades:** no té número de pressupost, ni data d'emissió (la validesa d'"1 mes" no es pot
calcular), ni versió, ni desglossament de partides dins de cada capítol. Al CRM: número correlatiu, data,
versió i data de caducitat obligatoris.

## 2. Contracte d'execució d'obra (PDF, 52 pàgines, castellà)

Contingut: contracte (40 clàusules, pàg. 1–15), Annex I projecte tècnic i constructor executor (pàg. 15),
**Annex II pressupost i forma de pagament (pàg. 16–18)**, Annex III memòria de qualitats, Annex IV
condicions particulars d'harmonització, dossier tècnic (pàg. 26–51) i pàgina de signatures (pàg. 52).

Dades rellevants per al CRM:
- Preu tancat: **496.280,00 € + IVA "al tipus legal vigent"** (clàusula 2a, pàg. 2). Cap tipus d'IVA fixat.
- Pagament a **3 dies hàbils** des de la recepció de cada factura (cl. 3a) → data de venciment = data factura + 3 dies hàbils.
- Termini: 240 dies hàbils des de l'entrega del material estructural; exclou agost, 22/12–7/1, festius i meteorologia (cl. 4a).
- Extres posteriors sense calendari: **50 % encàrrec / 30 % inici / 20 % finalització** (cl. 7a).
- Penalització 3 % mensual de l'obra pendent, màxim 10 % (cl. 8a). Resolució per impagament amb 10 dies de gràcia (cl. 30a).
- L'entrega de claus meritja automàticament l'últim pagament (cl. 21a); l'ocupació anticipada equival a entrega (cl. 22a).
- Constructor executor extern designat a l'Annex I (empresa constructora principal → taula `companies`).
- Annex IV: tarifes unitàries d'extres no contractats (punt de llum 40 €, endoll exterior 70 €, circuit aerotèrmia 350 €, rases 25–35 €/ml, enrajolat 15/35 €/m²…) → **catàleg de tarifes d'extres** configurable.

### 2.1 Fites de cobrament (Annex II)
14 blocs, **37 fites** amb import propi. Totes les sumes internes quadren:

| Fase | Import | Fites | Verificació |
|---|---:|---:|---|
| F1 Projecte i treballs previs | 35.600 € | 2 | ✔ |
| F2 Cimentació (inclou escomeses) | 39.500 € | 6 | ✔ |
| F3.1 Estructura i envolupant | 135.180 € | 5 | ✔ |
| F3.2 Interiors i instal·lacions | 90.500 € | 5 | ✔ |
| F3.3 Fusteria i entrega | 32.500 € | 3 | ✔ (F3 = 258.180 € = 260 × 993) |
| F4.2 Garatge / F4.3 Piscina / F4.4 Clima / F4.6 Terrassa PB / F4.7 Camí / F4.8 Plaques | 129.950 € | 16 | ✔ cada extra |
| **F4.1 Cuina / F4.5 Terrassa P1 / F4.9 Altures** | **33.050 €** | **0** | ⚠ sense calendari |
| **Total** | **496.280 €** | | = preu del contracte |

## 3. Discrepàncies i punts a revisar

| # | Gravetat | Discrepància | Tractament al CRM |
|---|---|---|---|
| D1 | **Alta** | Pressupost 496.580 € vs contracte 496.280 € (−300 €). **Origen localitzat: escomeses.** Pressupost: 3.800 €; fites del contracte F2.03 + F2.04 = 2.250 + 1.250 = **3.500 €**. La cimentació quadra (36.000 € en tots dos). | **Resolt:** direcció confirma que és un error de càlcul i s'ignora. El contracte original no es toca. |
| D2 | **Alta** | Tres extres sense fites (cuina 12.300 €, terrassa P1 4.800 €, altures 15.950 €). La cl. 7a diu que els extres de l'Annex II es paguen segons els "vencimientos específicos" de l'annex, i el 50/30/20 només s'aplica a extres **posteriors**. Per a aquests tres no hi ha cap regla explícita. | Marcar com a "no determinable". Direcció decideix: fita única, 50/30/20 per analogia o un altre calendari. No aplicar cap percentatge automàticament. |
| D3 | Mitjana | Error tipogràfic a l'encapçalament de F2: "39.5000,00 €". | El lector IA ha de validar la xifra amb la suma de les fites i assenyalar el format anòmal. |
| D4 | Mitjana | Data del contracte a l'encapçalament (13/10/2026) però **lloc i data en blanc** a la pàgina de signatures (pàg. 52). | Guardar la data de signatura efectiva com a camp propi, separat de la data del document. |
| D5 | Mitjana | La cl. 4a compta el termini des de l'"entrega del material estructural", que no és cap fita. | Crear l'esdeveniment "entrega material estructural" al seguiment d'obra per calcular la data prevista. |
| D6 | Baixa | Format irregular d'imports: "5.750,00 + IVA" (sense €), "5.000 €" (sense decimals), "35.600€" (sense espai). | Normalitzador d'imports robust + revisió humana. |
| D7 | Baixa | El pressupost separa "cimentació" i "escomeses"; el contracte les agrupa ("cimentación, acometidas y conexiones"). Les altures són 2 línies al pressupost i 1 fase (F4.9 = 10.500 + 5.450) al contracte. | Mapatge pressupost↔contracte amb correspondències N:1 i verificació per suma. |
| D8 | Baixa | El dossier tècnic està datat "Juny 2026" i diu "no s'aplica termini de validesa", mentre que el pressupost té validesa d'1 mes. | Prevalença segons la cl. 19a: contracte > pressupost > memòria. Guardar l'ordre de prevalença a la fitxa del contracte. |

## 4. Plantilla de factura (Excel `.xlsm`)

**Pestanyes:** `FACTURA` (plantilla), `CLIENTS` (base de dades de clients), `BASE OLIVIÉ` (una altra plantilla).

**Estructura de `FACTURA`:**
- Emissor fix: raó social, CIF, adreça, email. Logotip incrustat.
- Idioma per client: columna `IDIOMA` (CATALÀ/CASTELLÀ) → tots els literals s'obtenen amb `IF(C2="CASTELLÀ",…)`.
- Client seleccionat amb una llista desplegable; NIF i adreça amb `VLOOKUP`; ubicació = població + CP + província.
- Línies: descripció / preu / unitats / total (`=G*H`), files 18–37 (20 línies màx.).
- Peu: text legal de l'operació ("Execució d'obra d'habitatge unifamiliar de nova construcció, destinat a ús residencial privat"), IBAN, SUBTOTAL `=SUM(I18:I37)`, IVA (un únic tipus per factura, triat entre 4 %, 10 % i 21 %), TOTAL.
- Número de factura manual amb format `AA-NNN` (p. ex. `26-013`).
- Macro `PDF`: exporta el full a una ruta fixa d'un ordinador concret.
- Identitat: tipus de lletra **Montserrat**, blau marí **#1C354B**, daurat **#C9AB5D**, fons de capçalera de taula blau i total destacat en daurat.

**Riscos detectats (no s'han de reproduir al CRM):**

| # | Risc | Solució al CRM |
|---|---|---|
| E1 | **Data de factura `=TODAY()+1`**: canvia cada vegada que s'obre el fitxer i a més és la data de demà. | Data d'emissió fixada i immutable en emetre-la. |
| E2 | Numeració manual, sense control de duplicats ni de salts. | Comptador per sèrie i any dins d'una transacció, únic i sense buits. |
| E3 | Sense arrodoniment (`I40 = I39*H40`): la quota d'IVA es mostra arrodonida però es desa amb més decimals. | Imports en cèntims enters; quota = arrodoniment de base × tipus, per tipus. |
| E4 | Un sol tipus d'IVA per factura. | IVA per línia, desglossat per tipus al peu. |
| E5 | La macro sobreescriu sempre el mateix PDF: no queda còpia de cada factura emesa. | PDF generat al servidor, desat a Storage `factures`, immutable i amb hash. |
| E6 | Format de data `mm-dd-yy` (format americà). | `dd/mm/aaaa`. |
| E7 | El rang del `VLOOKUP` d'idioma (`A2:G123`) no coincideix amb la resta (`A2:F123`) ni amb la llista desplegable (`A2:A75`). | Dades de client relacionals. |
| E8 | Raó social escrita "SRL" a la factura i "S.L." al contracte i al pressupost. | Dades fiscals de l'emissor en una sola configuració, revisada. |
| E9 | No inclou referència de projecte, de fita ni data de venciment; no distingeix serveis tècnics i construcció; no preveu rectificatives. | Camps i sèries propis (vegeu §5). |

**Dades personals:** la pestanya `CLIENTS` conté noms, NIF i adreces reals de diversos clients, i el fitxer
inclou dos IBAN. **No s'han copiat al repositori.** Si es volen importar, es farà directament a la base de dades
de producció amb una importació controlada, mai com a fitxer de proves.

**`BASE OLIVIÉ`:** és una factura d'una persona física **a** ModularDom (serveis comercials, IRPF −15 %, IVA 21 %).
No és una factura emesa per ModularDom, sinó una **factura rebuda** → mòdul de costos (FASE 4), no el generador.

## 5. Conseqüències per al model de dades (fases 2 i 4)

- **Pressupostos:** `quotes` → `quote_versions` (immutables un cop enviades/acceptades) → `quote_lines`
  (capítol: construcció, cimentació, escomeses, projecte; tipus: base / extra inicial / extra posterior /
  descompte; quantitat, unitat, preu en cèntims; `vat_rule_id`). Total "clau en mà" = base + extres.
- **Contractes:** `contracts` (preu, data document, data signatura, ordre de prevalença) →
  `contract_extractions` (versió de la interpretació IA, model, data) → `contract_milestones`
  (codi, fase, subfase, concepte, import en cèntims, condició que l'activa, ordre, pàgina, text original,
  estat de validació) + `contract_discrepancies` (tipus, import esperat/trobat, resolució, qui/quan).
- **Regles de pagament d'extres:** `payment_rules` amb la regla per defecte del contracte (50/30/20) i
  regles específiques per extra; només s'activen després de la validació de direcció.
- **Catàleg de tarifes unitàries** (Annex IV) per pressupostar extres posteriors.
- **Facturació:** sèries configurables (proposta: `T` serveis tècnics, `C` construcció, `R` rectificatives,
  totes amb el format actual `AA-NNN`), `invoices` → `invoice_lines` (IVA per línia) → `invoice_tax_totals`;
  vincle factura↔fita; venciment = emissió + N dies hàbils (3 en aquest contracte); text legal de
  l'operació per idioma; IBAN de l'emissor a la configuració, no al codi.
- **IVA:** taula `vat_rates` (0 %, 4 %, 10 %, 21 %) i regles **configurables** per tipus de concepte i
  projecte, sempre amb confirmació manual a l'emissió.

## 6. Punts que necessiten una decisió vostra o del vostre assessor fiscal

1. ~~**D1 — els 300 € d'escomeses**~~ — **Resolt (8/11/2026):** direcció confirma que és un error de càlcul i
   que s'ha d'ignorar. El CRM no generarà cap avís per aquesta diferència en aquest contracte.
2. **D2 — calendari de cobrament dels extres — decidit (8/11/2026):** el calendari de cada extra és el que fixa el
   contracte de cada client, per fites (no per dates). El lector IA l'extreu; si un extre no en té, ho marca com a
   no determinable i direcció defineix les fites a la pantalla de validació. Mai s'aplica cap percentatge genèric.
3. **Tipus d'IVA per concepte — decidit per direcció (8/11/2026):** **21 %** per als serveis d'arquitectura
   (honoraris de projecte i direcció) i **10 %** per a la construcció. A la FASE 4 seran els valors per defecte
   de cada tipus de concepte, desats a la configuració (no al codi) i sempre visibles i modificables per línia
   abans d'emetre la factura. Els extres que no siguin clarament obra o arquitectura els haurà de classificar direcció.
4. **Sèries de facturació — decidit (8/11/2026):** una sèrie general `AA-NNN`; la darrera factura emesa és la
   **26-013**, de manera que la següent serà la 26-014 (configurat a `invoice_series`).
5. **Normativa de sistemes de facturació (Verifactu) — ajornat per decisió de direcció (8/11/2026).** Segons el BOE vigent, les societats han de tenir el
   sistema de facturació adaptat abans de l'**1 de gener de 2027** (RDL 15/2025). El 5 d'octubre de 2026
   Hisenda va anunciar un ajornament fins a l'octubre de 2028, que encara **no s'ha publicat al BOE**.
   El mòdul de facturació (FASE 4) es dissenyarà amb registres encadenats, immutables i traçables per poder
   adaptar-s'hi, però no s'afirmarà que compleix la norma sense verificació. Mentrestant, si la FASE 4 no és
   operativa abans de l'1/1/2027, cal confirmar amb l'assessor com continuar facturant.
