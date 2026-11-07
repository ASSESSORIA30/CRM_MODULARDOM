# Mòdul d'avantprojecte col·laboratiu

Integra les tres especificacions (revisions amb IA i documentació compartida, visor de plànols
amb anotacions, fotografies d'inspiració) dins del CRM existent. Reutilitza projectes, perfils,
documents, Storage, tasques, notificacions i auditoria. No hi ha cap sistema paral·lel.

## Estat per etapes

| Etapa | Contingut | Estat |
|---|---|---|
| **A** | Model de dades, permisos (RLS), rondes transaccionals, versions, publicació, anotacions, comentaris, inspiració, notificacions · Visor de plànols · Validació IA | ✅ Fet i provat |
| **B** | Espai de treball de direcció i arquitecte (`/projectes/[id]/avantprojecte`): pujada múltiple, versions, cua de publicació, visor amb anotacions, punts, fils de comentaris, galeria | ✅ Fet (pendent de prova amb Supabase real) |
| C | Portal del client **EL MEU AVANTPROJECTE** (5 subapartats), analitzar amb IA, pantalla de confirmació, enviament de ronda, respostes | Pendent |
| D | Resum de ronda i informe PDF amb captures del plànol i fotografies | Pendent |

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

## Espai de treball (etapa B)
Pestanyes: **Documents i plànols** (llista amb versions, pujada múltiple, visor amb marcadors, fil per document i per
marcador, adjunts per marcador, relació de punts de cada versió, enviar a publicar / publicar / retornar) ·
**Rondes i punts** (comptador de rondes, excepcions, punts amb resposta tècnica, alternativa, valoració econòmica,
historial, confirmacions del client i fil de comentaris) · **Galeria d'inspiració** (filtre per estança, vincles amb els
punts) · **Pendents de publicar** (només direcció). S'hi accedeix des de la fitxa del projecte (botó *Avantprojecte*).

Migració nova `20261107000700_participants.sql`: retorna només nom i rol dels participants d'un projecte,
perquè l'arquitecte i el client vegin qui comenta sense accedir a la taula de perfils.

## Seguretat de fitxers
- Mides i tipus permesos configurables a `upload_rules`; el bucket té la seva pròpia llista de tipus.
- Vercel limita el cos de les peticions a uns 4,5 MB: els fitxers es pugen directament a Storage amb URL
  signada d'un sol ús i, després, el servidor comprova el **tipus real** (signatura binària: un `.pdf` que és un
  executable es rebutja i s'esborra) abans de registrar-los. També es desa l'empremta SHA-256 de cada fitxer.
- Visualització i descàrrega només amb URL signades de 5–10 minuts.
- No hi ha antivirus integrat a Supabase. Si es vol escaneig, caldrà un servei extern (p. ex. una Edge Function amb
  un proveïdor d'escaneig); queda preparat el camp `sha256`.
