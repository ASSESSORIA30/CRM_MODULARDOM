# Mòdul d'avantprojecte col·laboratiu

Integra les tres especificacions (revisions amb IA i documentació compartida, visor de plànols
amb anotacions, fotografies d'inspiració) dins del CRM existent. Reutilitza projectes, perfils,
documents, Storage, tasques, notificacions i auditoria. No hi ha cap sistema paral·lel.

## Estat per etapes

| Etapa | Contingut | Estat |
|---|---|---|
| **A** | Model de dades, permisos (RLS), rondes transaccionals, versions, publicació, anotacions, comentaris, inspiració, notificacions · Visor de plànols · Validació IA | ✅ Fet i provat |
| **B** | Espai de treball de direcció i arquitecte (`/projectes/[id]/avantprojecte`): pujada múltiple, versions, cua de publicació, visor amb anotacions, punts, fils de comentaris, galeria | ✅ Fet (pendent de prova amb Supabase real) |
| **C** | Portal del client **EL MEU AVANTPROJECTE** (5 subapartats), analitzar amb IA, pantalla de confirmació, enviament de ronda, respostes | ✅ Fet (pendent de prova amb Supabase real) |
| **D** | Resum de ronda i informe PDF amb captures del plànol, marcadors, fotografies, respostes, estat i referències; arxivable a la documentació | ✅ Fet (pendent de prova amb Supabase real) |

## Decisions preses (revisables)
1. **Publicació sempre validada per direcció.** L'arquitecte pot deixar documents interns o enviar-los a revisió;
   només direcció els publica al client (no només les versions de l'avantprojecte). És l'opció més segura amb
   l'especificació, que permetia interpretar-ho de les dues maneres.
2. **Accés del client durant l'avantprojecte.** El prompt mestre diu que el client entra després del contracte;
   aquest mòdul necessita que hi entri abans. Direcció activa el compte quan vulgui (ja és manual).
3. **Rondes:** 3 per projecte (`projects.revision_rounds_base`, configurable) + excepcions de direcció amb motiu
   obligatori. La ronda només es consumeix a `submit_revision_round()`.
4. **Una mateixa imatge vinculada a diversos punts** = un sol fitxer i diversos vincles (`document_links`).
5. **Fitxers DWG/DXF:** es poden pujar i descarregar; no es previsualitzen. Les anotacions es fan sobre la versió PDF/imatge.
6. **IA:** proveïdor configurable (Anthropic per defecte). Sense `ANTHROPIC_API_KEY`, tot funciona introduint els
   punts a mà. Abans d'activar-la cal un contracte de tractament de dades amb el proveïdor, perquè s'hi enviaran
   textos i fotografies dels clients.

## Garanties implementades a la base de dades
- **Rondes:** màxim 3 + excepcions; enviament **idempotent** (clau única per enviament) i **serialitzat**
  per projecte (bloqueig de fila). Provat amb dos enviaments simultanis reals: només se'n crea una.
- No consumeixen ronda: esborranys, anàlisi IA, edició de punts, marcadors, pujada de documents, comentaris,
  respostes, acceptar alternatives, demanar aclariments.
- Després de les rondes: el client continua veient documents i conversant; només es bloqueja enviar-ne de noves.
- **Interns vs compartits:** documents, anotacions i comentaris interns mai són visibles al client, tampoc per
  URL directa de Storage. Els comentaris del client són sempre compartits; no pot respondre fils interns; no se'l
  pot mencionar en notes internes.
- **Versions:** els documents publicats o aprovats no es poden sobreescriure ni eliminar; cada versió nova
  manté el grup; en publicar-ne una, l'anterior passa a "substituïda" i continua consultable.
- **Anotacions:** coordenades normalitzades 0–1, vinculades a la versió exacta i a la pàgina; no es poden moure a
  un altre document o pàgina; no es copien a versions noves.
- **Punts:** una tasca per punt a l'arquitecte; estats Pendent → … → Incorporat/Descartat; alternatives amb resposta
  del client; historial (`revision_item_events`) i confirmacions amb data i identitat.
- **Extres:** "Requereix valoració econòmica" → avís a direcció → decisió (pressupostar / sense cost). No crea
  factures ni toca imports; el vincle amb el mòdul d'extres es completarà a la FASE 4.

## IA: com s'evita que inventi
`src/lib/ai/revision-validate.ts` valida qualsevol resposta del model:
- cada punt ha de citar fragments **literals** del text del client, d'un marcador o d'un adjunt; si no, es marca per aclarir;
- s'eliminen mides, imports i percentatges que el client no ha escrit;
- s'eliminen valoracions de viabilitat;
- es descarten marcadors i adjunts inexistents;
- cap marcador es perd encara que la IA l'ometi.

## Proves
- Etapa B: 5 proves de verificació de fitxers; pàgina de proves de l'espai de treball amb Playwright (escriptori i mòbil);
  comprovació automàtica que les 189 columnes i relacions que llegeixen les pantalles existeixen a l'esquema.
- `scripts/test-db-local.sh`: 89 comprovacions del mòdul (+ les anteriors) i prova de concurrència.
- `npm test`: geometria del visor (9) i validació IA (8), a més de les anteriors.
- `tests/e2e/test_plan_viewer.py` (Playwright): posició dels marcadors amb zoom i canvi de mida, rectangles,
  PDF multipàgina, "Veure al plànol", gestos tàctils en iPhone (un dit, pessic) sense anotacions accidentals,
  imatges. Executar amb el servidor en marxa i `ENABLE_TEST_ROUTES=1`.
- Etapa D: `src/lib/report/report.test.ts` (classificació del resum, text compatible amb el PDF, PDF validat amb
  `pdftotext`/`pdfimages`) i `tests/e2e/test_round_report.py` (vista HTML i PDF descarregat des de `/proves/informe`:
  resum, referències, respostes, 3 captures de marcadors + 1 fotografia).

## Espai de treball (etapa B)
Pestanyes: **Documents i plànols** (llista amb versions, pujada múltiple, visor amb marcadors, fil per document i per
marcador, adjunts per marcador, relació de punts de cada versió, enviar a publicar / publicar / retornar) ·
**Rondes i punts** (comptador de rondes, excepcions, punts amb resposta tècnica, alternativa, valoració econòmica,
historial, confirmacions del client i fil de comentaris) · **Galeria d'inspiració** (filtre per estança, vincles amb els
punts) · **Pendents de publicar** (només direcció). S'hi accedeix des de la fitxa del projecte (botó *Avantprojecte*).

Migració nova `20261107000700_participants.sql`: retorna només nom i rol dels participants d'un projecte,
perquè l'arquitecte i el client vegin qui comenta sense accedir a la taula de perfils.

## Portal del client (etapa C)
Menú **El meu avantprojecte** (`/portal/[projecte]`), amb el comptador de rondes sempre visible:
1. **Avantprojecte actual**: versió vigent al visor (amb les respostes i marcadors compartits), versions anteriors,
   què ha canviat (relació de punts de la versió), "He revisat aquesta versió" i "Aprovar formalment" (amb confirmació explícita).
2. **Sol·licitar modificacions**: (1) marcadors i zones sobre el plànol amb text i fotografies d'inspiració;
   (2) text lliure i **ANALITZAR AMB IA**; (3) punts editables (editar, afegir, eliminar, reordenar, vincular marcadors,
   adjuntar fitxers); (4) **pantalla de confirmació** amb miniatura del plànol i marcador per a cada punt. Només en confirmar
   es consumeix la ronda (clau d'idempotència única per pantalla).
3. **Seguiment dels canvis**: estat de cada punt, resposta de l'arquitecte, acceptar / rebutjar alternatives, demanar
   aclariments, "He revisat la resposta", fil de comentaris i "Veure al plànol".
4. **Documentació**: pujada (també des de la càmera del mòbil), versions, descàrregues i galeria d'inspiració.
5. **Missatges**: conversa general amb l'equip (migració `0800`) i activitat recent.

Els enllaços de les notificacions que reben els clients porten a l'apartat equivalent del portal.
Sense `ANTHROPIC_API_KEY`, el text es desa i el client afegeix els punts a mà.

## Resum i informe de ronda (etapa D)
- Ruta: `/projectes/[id]/avantprojecte/informe/[ronda]`. Hi accedeixen direcció, l'arquitecte i el client del projecte
  (botó **📑 Resum i informe PDF** a cada ronda, tant a l'espai de treball com a *Seguiment* del portal). El constructor no.
- **Només contingut compartit amb el client:** marcadors i comentaris `compartit`, documents `publicat`/`compartit`,
  i la resolució de la **darrera versió publicada** que esmenta cada punt. Cap nota interna hi apareix, ni quan el genera l'equip.
- **Resum sense IA:** es construeix amb els estats, les respostes, les confirmacions i la relació de punts per versió
  (`summarizeRound`). Cada línia cita les referències `R<ronda>.<punt>`; res no es dedueix ni s'inventa.
- **PDF** (pdf-lib, al navegador): capçalera, resum, cada punt amb la captura de la pàgina exacta del plànol i el
  marcador dibuixat, fotografies (WEBP es converteix a JPEG), resposta de l'arquitecte, alternativa, valoració
  econòmica, confirmacions amb data i persona, comentaris compartits, resolució final i documents de referència;
  peu "Pàgina x de y". Si una imatge no es pot obtenir, l'informe es genera igualment amb el text i les referències.
- **Arxivar** (direcció/arquitecte): desa el PDF a la documentació de l'avantprojecte com a `memoria`, **intern**;
  si ja n'hi havia un de la mateixa ronda, en crea una versió nova. Per fer-lo visible al client, s'envia a publicar
  com qualsevol altre document (validació de direcció).
- També es pot imprimir des del navegador (la barra lateral s'amaga en imprimir).

## Contracte, factures i documents del projecte
- Migració `20261108000900_documents_projecte.sql`: regles de pujada per als buckets `contractes`, `factures` i `documents`.
- Direcció hi puja i gestiona els fitxers des del botó **📄 Contracte i factures** del projecte
  (`/projectes/[id]/documents`): contracte signat i annexos, factures i justificants, i altres documents
  (llicència, visat, projecte tècnic, certificacions, acta d'entrega…).
- Tot queda **privat** fins que direcció prem **Publicar al client**; es pot retirar o arxivar en qualsevol moment.
- El client ho veu a l'apartat **Contracte, factures i documents** del seu portal. L'arquitecte no veu les factures.
- Prova: `supabase/tests/05_documents_projecte_test.sql`.

## Seguretat de fitxers
- Mides i tipus permesos configurables a `upload_rules`; el bucket té la seva pròpia llista de tipus.
- Vercel limita el cos de les peticions a uns 4,5 MB: els fitxers es pugen directament a Storage amb URL
  signada d'un sol ús i, després, el servidor comprova el **tipus real** (signatura binària: un `.pdf` que és un
  executable es rebutja i s'esborra) abans de registrar-los. També es desa l'empremta SHA-256 de cada fitxer.
- Visualització i descàrrega només amb URL signades de 5–10 minuts.
- No hi ha antivirus integrat a Supabase. Si es vol escaneig, caldrà un servei extern (p. ex. una Edge Function amb
  un proveïdor d'escaneig); queda preparat el camp `sha256`.
