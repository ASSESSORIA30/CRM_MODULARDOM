# Motor únic de normalització de tarifes i correcció SIPS → Comparatives IA

Branca: `feature/motor-normalitzacio-tarifes` (creada a partir de `main`).
SQL: **032_motor_normalitzacio.sql**, que s'aplica després de la 031.

## Part 1 · Correcció prioritària: SIPS → Comparatives IA

### Causa de la pèrdua dels consums
Des de la fitxa 360, el total anual i les potències del subministrament arribaven marcats com a **«manual»**, encara que fossin dades desades al CRM.

La regla d'emplenat només posava els P1–P6 del SIPS si el total era substituïble o coincidia (±1 kWh) amb la suma SIPS. La xifra anual del CRM i la finestra de 12 mesos del resum SIPS gairebé mai coincideixen. Per això els períodes es descartaven sense cap avís i només arribaven el total i les potències.

També es descartaven tots els períodes si el resum EAS no portava el total mensual (`EActivaMes`), encara que els P1–Pn i les dates fossin complets.

### Què s'ha corregit
- **Una sola funció** (`proposalAutofill`) serveix per a tots els botons «Generar proposta»: fitxa 360, cercador de CUPS, consulta SIPS, contractes, captació i reobertura d'esborranys. Aprofita la consulta SIPS que ja hi ha a la memòria cau.
- Els P1–P3 (2.0TD) o P1–P6 (3.0TD i 6.1TD) s'omplen sempre que els camps estiguin buits o no s'hagin editat a mà.
- El total s'alinea amb la suma dels mateixos períodes, de manera que tots dos corresponen a la mateixa finestra.
- Un total escrit a mà o tret d'una factura no es trepitja: es conserva i la validació avisa de la diferència.
- Els valors desats al CRM ja no compten com a «manual» de la comparativa.
- Si falta el total mensual EAS però els períodes són complets, ara és un avís i ja no es descarta el desglossament.

### Procedència de cada dada (nou)
- **Etiqueta petita** al costat de cada camp de consum P1–P6, consum total i potència P1–P6: SIPS, Factura, Corba horària, Manual o CRM. La de CRM surt quan és un valor del CRM d'origen no acreditat.
- Si es modifica un valor, l'etiqueta passa a **Manual** i es guarda el valor, la font i la data originals.
- Un camp buit no mostra cap etiqueta.
- **En passar el cursor o prémer l'etiqueta** es veu:
  - la font;
  - la data de consulta o d'extracció, només si està acreditada;
  - el valor original, si s'ha modificat;
  - si la dada és real, calculada o manual.
- La procedència es manté:
  - en tots els passos de la comparativa;
  - als esborranys (els antics se'n deriven sense inventar dates);
  - a la comparativa desada (snapshot) i en reobrir-la.
- **Validació del total:**
  - 2.0TD: total = P1 + P2 + P3. 3.0TD i 6.1TD: total = P1 + … + P6.
  - Tolerància d'arrodoniment: 1 kWh o el 0,1 %.
  - Si les fonts són diferents, l'avís diu que poden ser finestres temporals diferents.
  - Si només hi ha el total, no s'inventa cap repartiment.
- **Corba horària:** el botó «Calcula els consums per períodes amb la corba» reparteix els kWh reals amb el calendari de la Circular CNMC 3/2020.
  - 2.0TD: P1, P2 i P3.
  - 3.0TD i 6.xTD: P1–P6 per temporades.
  - Caps de setmana i festius nacionals inclosos.

### Límits del proveïdor SIPS
- El desglossament ve del resum EAS de 12 mesos (`ResumenConsumosU12M`). No és la suma de factures: EAS pot repartir lectures entre mesos.
- La finestra de 12 mesos no coincideix sempre amb el consum anual del llistat SIPS. Per això el total del llistat i la suma de períodes poden diferir.
- Si el portal no retorna algun període o hi ha una discrepància interna de més d'1 kWh, el desglossament no es dona per bo. En aquest cas cal una factura o la corba horària.
- No s'ha fet cap consulta real al portal SIPS des d'aquí: tot s'ha provat amb simulació.

## Part 2 · Motor únic de normalització i validació de tarifes

**Un sol motor** (`src/comparator/tariff-engine.ts`) amb **adaptadors per comercialitzadora** (`supplier-adapters.ts`): Nufri, Iberdrola, Endesa, Naturgy, Gana Energía, NIBA, Novaluz i un adaptador genèric per a les noves.

S'aplica en llegir el document, en desar al catàleg, en importar i en reprocessar. Per això el lector, el catàleg, el comparador i el PDF fan servir les mateixes dades.

- **Unitats:**
  - Hi ha un registre únic d'unitats. Cadascuna té la seva base: per subministrament, per contracte, per potència, per consum o percentatge. Així no es confonen.
  - Conversions documentades:
    - energia: €/MWh → €/kWh i c€/kWh → €/kWh;
    - potència: €/kW·any → €/kW·dia (÷ 365) i €/kW·mes → €/kW·dia (× 12 ÷ 365);
    - quota per subministrament: €/mes → €/dia (× 12 ÷ 365), amb el cost mensual, l'anual i el d'un període.
  - Sempre es conserva el preu i la unitat originals.
  - S'han eliminat tres conversions fetes a mà que perdien precisió.
- **Unitats visibles:**
  - Catàleg, lector i taula de revisió: tots els preus surten amb la seva unitat. Si el document en feia servir una altra, també surt l'original, per exemple «… €/kW·dia (doc.: … €/kW·any)».
  - Terme fix del gas: es mostra com «5,17 €/cliente/mes (0,169973 €/client·dia · 62,04 €/any)». El full del PDF el mostra amb la unitat original.
  - Comissions: es mostren en €/contracte, €/MWh, €/kW o %.
- **Períodes:**
  - Es reconeixen la 2.0TD (3 preus) i la 3.0TD i 6.1TD (6 preus).
  - Si una 3.0TD té només 3 preus, és un error, amb l'avís «possible confusió entre el número de la tarifa i la quantitat de preus».
  - Si el nom de la tarifa diu «3 precios» en una tarifa de 6 períodes, surt un avís.
  - Un preu en un període que la tarifa no té (per exemple, P4 en una 2.0TD) és un error.
  - Una tarifa amb el mateix preu a tots els períodes s'identifica com a **24 hores**. El cost és idèntic.
- **Nufri:**
  - 3.0TD: sis preus, sempre amb el nom «Seis precios».
  - 3.0TD a preu fix: **permanència reconeguda automàticament**, sense confirmació manual. La durada queda sense determinar, perquè el document no la diu.
  - Gas: **terme fix en €/mes** aplicat automàticament. Direcció encara la pot canviar a la previsualització.
- **Permanència en general:**
  - Es llegeixen del text de condicions la permanència, la durada (només si consta), la penalització, la renovació, la vigència i les excepcions.
  - Una permanència sense durada al document ja **no bloqueja**: es mostra com «sí (durada no especificada al document)».
- **Comissions:**
  - Cada tarifa es vincula a les seves regles i se separen:
    - per part: comercialitzadora, comercial i col·laborador;
    - per tipus: energia, potència, fixa, percentatge i retrocessió.
  - Hi ha un tipus de regla nou, **«Import per kW»**. Exemple: (40 × 6) × 2 = 480 €.
  - La regla per kW calcula **només** si diu sobre quina potència es paga: suma de períodes, P1 o la màxima. Sense aquesta dada queda «pendent de configuració».
  - El tipus Nufri (energia + potència) es manté com estava.
  - S'han corregit tres errors:
    - en editar una regla es perdien les seves condicions;
    - les regles «% energia» i «% potència» no es podien desar per la unitat;
    - els imports fixos es mostraven com «€» en lloc de «€/contracte».
- **Taula de revisió abans d'importar:** surt al lector amb IA, al d'Excel i al de Nufri. Té les 12 columnes demanades:
  - comercialitzadora, nom exacte, subministrament i tarifa d'accés;
  - modalitat, preus per períodes, unitats originals i valors normalitzats;
  - permanència, comissions (només Direcció), vigència i incidències.
  - Les incidències se separen en error, dada essencial absent, avís i informació. Les condicions verificades automàticament surten com a tals i no es demana confirmar-les.
- **Reprocessament segur:** botó «Reprocessa amb el motor» al catàleg, només per a Direcció.
  - Primer mostra una simulació.
  - Després crea **versions noves en esborrany** de les tarifes triades.
  - No modifica cap versió existent ni cap proposta emesa.

## Proves
- **Comprovacions finals:** typecheck correcte, **1.177 tests superats** (78 fitxers, inclosos els de base de dades), lint sense errors i build correcte.
- **Tests nous:**
  - `tests/sips-comparatives-periodes.test.ts` (18): 2.0TD, 3.0TD, 6.1TD i gas; total manual protegit; només total; procedència i original; validació del total; corba horària.
  - `tests/motor-normalitzacio-tarifes.test.ts` (22): conversions; períodes; 24 hores; Nufri amb els PDF reals; permanències; comissions (480 €); coincidència entre catàleg, comparador i PDF; reprocessament.
  - `tests/db/motor-normalitzacio-rls.test.ts` (2): migració 032 sobre PostgreSQL de prova (idempotent i reversible).
  - `npm run test:sips-summary`: 46 proves superades.
- **Tests actualitzats perquè la regla ha canviat:**
  - Una permanència sense durada ja no bloqueja.
  - El gas de Nufri ja no queda pendent de confirmar la unitat.
- **Provat de debò:** amb els PDF reals de Nufri del 05/11/2026.
- **Provat amb simulació:** SIPS, Supabase i el desat al catàleg.
- **No provat en navegador:** les etiquetes de procedència, la taula de revisió i el reprocessament no s'han vist en una pantalla real.
