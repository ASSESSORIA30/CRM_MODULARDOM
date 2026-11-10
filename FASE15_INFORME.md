# Fase 15 · Preu base + FEE, indexada + marge i aprenentatge persistent del lector

Branca: `feature/tarifes-preu-base-fee` · Migració nova: **038** (+ `_down`) · Data: 10/11/2026

## 1. Diagnòstic: per què «Ensenyar a la IA» no treia les tarifes de «Pendent de revisió»

Causes reals trobades al codi (cas Iberdrola · gas · terme fix en €/mes):

1. **Ordre de les regles (causa principal).** La frase «Totes les tarifes de gas d'Iberdrola…» és una regla *general*.
   Les regles generals s'apliquen primer i la regla de coneixement d'Iberdrola «Gas: unitat del terme fix per confirmar»
   (abast plantilla) s'aplicava després i **tornava a posar l'avís**. Resultat: la regla quedava desada i aprovada, però
   totes les tarifes RL.1–RL.3 continuaven «a revisar».
2. **Plantilla verificada congelada.** Els documents nous es llegien amb la versió *verificada* de la plantilla; les
   regles aprovades en versions posteriors s'ignoraven fins que algú tornava a verificar-la (cosa que el full d'Iberdrola
   no permet perquè té tarifes realment pendents).
3. **Dos aprenentatges desconnectats.** La regla d'unitat del catàleg (036) no arribava al lector de taules, i una regla
   «de plantilla» buscava la plantilla pel **nom** dins del text d'origen (si el nom no coincidia, afectava 0 tarifes).
4. **Aprovar una regla de producte revocava la general** de la mateixa comercialitzadora.
5. **Lector sense plantilla desada:** una regla d'unitat no es podia guardar («Desa primer la plantilla»).
6. **Estats poc explicatius:** només «A revisar», sense dir quin concepte fallava.

## 2. Què s'ha canviat

**Aprenentatge persistent i efectiu**
- Els avisos de revisió es resolen per *concepte* (`reviewConcern`): una regla aprovada que confirma la unitat el treu,
  sigui quin sigui l'abast o l'ordre.
- El xat entén «totes les tarifes de gas d'Iberdrola…» com a regla general de la comercialitzadora.
- Les regles d'unitat aprovades s'apliquen també al lector (mateix resultat al lector i al catàleg).
- Les regles aprovades de versions posteriors s'apliquen als documents nous; les proposades, no.
- En desar una regla aprovada, la plantilla es **verifica dins del mateix flux** i, si falla, es diu quina comprovació.
- Plantilla per identificador; aprovar una regla només substitueix la del mateix abast.
- Reprocessament: decideix amb l'estat de revisió per concepte; si una tarifa falla, la resta continua i l'informe diu
  «NO aplicada del tot».

**Estats de revisió** (separats de l'estat de publicació i del de la plantilla): Error de lectura · Pendent
d'interpretació · Pendent d'aprovació · Revisió necessària · Pendent de verificació · Validada. Al catàleg i al lector
es veu cada comprovació (terme fix, terme variable, descompte, tipus, regles) i el «Motiu pendent».

**Preu base + FEE i indexada + marge** (motor central `src/comparator/pricing-model.ts`)
- Models FIXED_FINAL, FIXED_BASE_FEE, INDEXED, INDEXED_BASE_FEE. El preu base no es modifica mai; el final es recalcula
  sempre des de la base (sense dobles FEE). FEE únic o per període, €/kWh ↔ €/MWh amb aritmètica decimal, FEE
  recomanat (avís) ≠ màxim contractual (bloqueja), FEE zero, FEE negatiu només amb regla explícita, FEE abans o després
  de descomptes.
- Indexades: el marge de la comercialitzadora és un component de la fórmula; el FEE d'Assessoria 3.0 només s'hi afegeix
  com a component separat si el contracte ho autoritza.
- **Pla OMIE d'Iberdrola:** sempre INDEXED i **sense FEE**. El marge el fixa Iberdrola per nivell (Plan OMIE 0, 1, 2, 3,
  Obras, Comunidades) i cada nivell és un producte diferent del catàleg amb el seu marge (p. ex. 3.0TD: 34, 27, 20 i
  10 €/MWh). Per canviar de marge es tria un altre nivell. Ni la IA, ni una regla apresa, ni l'editor no hi poden posar
  un FEE (error al catàleg i al servidor).
- Lector IA: demana i contrasta el model de preu amb el context; sense evidències no converteix res. Panell de
  confirmació amb **CONFIRMAR TARIFA · EDITAR · CORREGIR AMB IA**; les correccions es desen com a regles de lectura de la
  comercialitzadora amb versions.
- Catàleg: «CONFIGURACIÓ DEL FEE COMERCIAL» (només Direcció la modifica, també al servidor).
- Comparador: botó **EDITAR FEE** a cada tarifa BASE + FEE; recalcula preus, cost, estalvi i remuneració estimada sense
  tornar al SIPS i sense tocar el catàleg; el servidor valida el FEE (rols i límits).
- Comissions: models de remuneració a `fin_rules` (capa proveïdor), sense taula nova. Sense regla: «COMISSIÓ PENDENT DE
  CONFIGURAR». Conciliació estimada/liquidada/cobrada (l'estimació mai és «cobrada»).
- PDF: el client només veu preus finals; vista interna opcional amb base, FEE, marge i comissió. El portal públic del
  client rep la comparativa sense preu base ni FEE.
- Historial: taula `comparison_pricing_snapshots` (immutable un cop emesa la comparativa).

## 3. Proves

`npm run typecheck` ✔ · `npm run lint` ✔ (0 errors; 7 avisos que ja hi eren) · `npm run test` ✔ **1.389 proves** (1.314
anteriors + 75 noves, 94 fitxers) · compilació de Next.js ✔ (vegeu la nota de sota).

Fitxers nous de prova: `tests/fase15-preu-base-fee.test.ts`, `tests/fase15-aprenentatge.test.ts`,
`tests/fase15-servidor.test.ts` i `tests/db/preu-base-fee-rls.test.ts` (PostgreSQL real amb PGlite, migració 038 i _down).

Provat **amb simulació** (Supabase en memòria i PGlite), no contra el Supabase real.

Nota de compilació: en aquest entorn, `npm run build` es queda sense memòria en el pas intern de comprovació de tipus.
S'ha verificat per separat: `tsc --noEmit` correcte i `next build` complet (72 pàgines generades) desactivant només
aquell pas intern de tipus, sense canviar cap fitxer del projecte.

## 4. Pendents i limitacions

- Aplicar la migració 038 a Supabase (no s'ha aplicat).
- Configurar les regles de remuneració del FEE de cada comercialitzadora a Economia → Regles (capa Proveïdor).
- Si Iberdrola paga una comissió diferent per a cada nivell del Pla OMIE, cal una regla de remuneració per nivell
  (camp «Producte»: p. ex. «Plan OMIE 2»).
- La conciliació FEE estimat ↔ liquidació és una funció provada, però encara no té pantalla pròpia a Economia.
- El «FEE després de descomptes» s'aplica als descomptes percentuals de la tarifa; si el preu base ja porta el descompte
  del document (lectures d'Excel), el FEE s'hi suma després d'aquest descompte.
- Les tarifes antigues no s'han convertit a cap model nou (com es demanava).

## 5. Ampliació · circuit complet d'«Ensenyar a la IA» (plantilla `261109_Hoja_de_precios`)

**Cas reproduït** amb l'Excel real d'Iberdrola: 100 tarifes identificades, 15 descomptes dubtosos i 2 regles sense
aprovar (les mateixes xifres que a la plantilla v10).

**Per què les correccions no es reflectien** (causes trobades al codi):
1. Els documents nous es llegien amb la **versió verificada** de la plantilla (p. ex. v3) i ignoraven les regles aprovades
   a les versions 4–10. Passava al lector de documents (`TestDocument`) i al reconeixement automàtic de plantilles.
2. En confirmar una de les **2 regles de coneixement pendents** (horari promocionat 2.0TD i gas «Indexada») amb l'abast
   «aquest producte» o «regla general», es creava una regla nova i l'original continuava «pendent d'aprovar».
3. Cap comprovació després de desar: el xat deia «Regla guardada» sense tornar a llegir Supabase ni executar el motor, i
   les tarifes ja importades al catàleg no es reprocessaven.
4. Es podien desar regles repetides o contradictòries amb el mateix abast.

**Què fa ara** en confirmar una correcció:
1. Desa la regla (sense duplicats; una de contrària substitueix l'anterior, que queda a l'historial com a «substituïda»).
2. La torna a llegir de Supabase; si no hi és, dona error i no diu mai «guardada».
3. Executa el motor amb la versió vigent i el document desat, i diu quantes tarifes afecta, quantes resol i el motiu
   exacte de les que queden pendents. La previsualització es recarrega a l'instant.
4. Si és Direcció: intenta verificar la plantilla i reprocessa les tarifes importades d'aquell document. Una tarifa
   s'activa només si l'estat de revisió és «Validada» (cap descompte ni preu ambigu, cap regla pendent).
5. El xat mostra separadament: Regla guardada · Regla aprovada · Plantilla verificada · Tarifes validades.

**Resultat amb el document real:** 1 regla de gas + 4 confirmacions de descompte (una per text, no una per tarifa) +
2 regles aprovades → 97 de 100 interpretades. Les 3 restants (3.0TD Plan Regantes, 3.0TD i 6.1TD Estancias Verdes) tenen
dos preus per a sis períodes i cap regla validada: no es marquen correctes automàticament.

Proves noves: `tests/fase15-ensenyar-circuit.test.ts` (9). Total: 1.400 proves correctes, amb simulació.

## 6. Modificació · el FEE només es decideix a les comparatives

- **Catàleg i lector:** una tarifa PREU BASE + FEE es desa amb **només els preus base** de la comercialitzadora. No es
  demana, no es calcula i no s'aplica cap FEE en importar, validar ni desar; la tarifa es pot activar sense FEE. Si arriba
  un FEE (document, navegador o versió antiga) es descarta al servidor; el text del document només es guarda com a
  referència. L'editor del catàleg ja no té «FEE per defecte»: només el model, els preus base, el marge recomanat (avís) i,
  opcionalment, un màxim contractual real.
- **Comparatives IA:** nova secció «FEE comercial de cada opció». Cada tarifa BASE + FEE de la comparativa (fins a tres)
  té el seu FEE: únic per a P1–P6 o diferent per període, en €/kWh o €/MWh (÷ 1.000), zero per defecte, qualsevol valor no
  negatiu. Mostra per període el preu base, el FEE, el preu final, el consum anual i el cost, més el cost anual estimat i
  l'estalvi respecte de la tarifa actual. Es recalcula a l'instant, sense tornar a buscar la tarifa ni el SIPS.
- **Independència:** el FEE es desa només a la comparativa (ajust), apareix als càlculs i a la proposta, i no modifica el
  catàleg, Supabase ni altres comparatives. Cada client i cada proposta poden tenir un FEE diferent.
- **Avisos:** superar el marge recomanat només avisa; només bloqueja un FEE negatiu o un màxim contractual real si
  Direcció l'ha registrat. Les indexades OMIE + marge continuen amb el seu càlcul (i el Pla OMIE d'Iberdrola sense FEE).
- No cal cap migració nova: la 038 continua sent la mateixa.

## 7. Correcció definitiva del lector d'Iberdrola (`261109_Hoja_de_precios.xlsx`)

Branca `fix/lector-iberdrola-definitiu` (a partir de `main` amb els PR #3 i #4). Document real afegit a les proves.

**Causes trobades**
1. El xat confonia la correspondència P1–P6 amb el descompte: el missatge «0,215 × 0,80 = 0,172 → P1 = P2 = P3» creava
   la mateixa regla de períodes que ja existia → «la regla ja existia» → res no canviava.
2. Els descomptes dubtosos es confirmaven producte a producte (o per text exacte): calia repetir-ho a cada tarifa.
3. Una regla «ja existent» comptava l'efecte amb l'identificador nou (0 tarifes) i una proposta de l'Administració podia
   rebaixar a «proposada» una regla ja aprovada.
4. La verificació exigia que totes les tarifes estiguessin interpretades: amb 3 tarifes que el document no explica
   (dos preus per a sis períodes) la plantilla no es podia verificar mai; i no deia quines tarifes ho impedien.
5. La bonificació «100€ en Mi Iberdrola» bloquejava sense motiu (no és un descompte sobre el €/kWh).
6. El terme fix del gas en €/mes s'havia de tornar a ensenyar.
7. La importació només anava per lots a una pantalla; sense idempotència, un reintent podia duplicar tarifes.

**Correccions**
- Els dubtes del descompte tenen un TIPUS (2n any, anys creixents, descomptes múltiples). Direcció en confirma el concepte
  una vegada i s'aplica a totes les tarifes amb aquell dubte. El 2n any es conserva separat i no s'acumula.
- El xat i «Ensenyar amb un exemple» detecten quan els períodes ja són correctes i proposen resoldre el bloqueig real.
- Guardar una regla existent la torna a executar i n'informa (aprovada, tarifes afectades, resoltes, pendents).
- Verificar = lectura correcta (pestanya, columnes, preus, unitats, regles aprovades, cap fallida, cap pendent sense
  motiu) + llista de les tarifes que ho impedeixen + discrepàncies amb el catàleg. La validació comercial va a part.
- Importació per lots a totes les pantalles, amb un sol registre de progrés, reintents segurs i sense duplicats. Només
  s'activen les tarifes validades; les indexades sense fórmula completa queden en esborrany.
- Botó de Direcció «Activa les validades» al catàleg.

**Resultat amb el document real**
- Sense cap correcció: 100 identificades · 73 interpretades · 27 pendents amb motiu.
- Amb 3 accions de Direcció (confirmar el concepte del 2n any i aprovar les 2 regles de coneixement): 95 interpretades,
  plantilla verificable. Queden 5 que necessiten informació comercial real: Plan Más Ahorro 2.0TD_2 i 2.0TD_3 (descompte
  10/15/20/25/30 %) i 3.0TD Plan Regantes, 3.0TD i 6.1TD Estancias Verdes (dos preus per a sis períodes).
