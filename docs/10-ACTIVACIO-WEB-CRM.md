# Activació de la connexió web ↔ CRM

Ordre de treball, del més segur al més exposat. Cada fase es pot aturar sense desfer l'anterior.
El codi és a les branques `feature/web-leads-integration` (CRM) i `redesign/cinematic-v5` (web).
**Fusionar a `main` desplega a producció** (Vercel): no es fusiona fins que la fase 3 estigui feta
i autoritzada.

## Fase 1 — Entorn de proves aïllat (cap dada real)

1. **Supabase de proves.** Un projecte a part del de producció (el pla gratuït en permet dos; no
   cal contractar res). Si no hi ha lloc, es pot fer servir Supabase local (`supabase start`).
2. **Estat de les migracions.** A producció, només lectura:
   `select version from supabase_migrations.schema_migrations order by 1;` (o `supabase migration list`).
   Ha d'acabar a `20261117001100`. La nova és `20261126001200_web_leads.sql`.
3. **Aplicar totes les migracions al projecte de proves** (`supabase link --project-ref <proves>`
   i `supabase db push`). La nova només afegeix: una taula a `public`, una a `app` i tres funcions.
   No modifica cap taula, política ni funció existent, i no toca tarifes.
4. Crear-hi un usuari de direcció, un arquitecte i un client de prova (com a `docs/01`, pas A6).

## Fase 2 — Previsualitzacions connectades

Variables **només d'entorn Preview**, i al CRM limitades a la branca `feature/web-leads-integration`:

| Projecte | Variable | Valor |
|---|---|---|
| CRM | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | **les del projecte de proves** (si Preview hereta les de producció, la prova escriuria a producció) |
| CRM | `WEB_LEADS_SECRET` | secret nou (Sensitive) |
| CRM | `WEB_LEADS_ENABLED` | `true` |
| Web | `CRM_LEAD_URL` | `https://<previsualització del CRM>/api/web/leads` |
| Web | `CRM_LEAD_SECRET` | el mateix secret (Sensitive) |
| Web | `CRM_LEADS_ENABLED` | `true` |
| Web | `CRM_PROTECTION_BYPASS` | només si el CRM té Deployment Protection (vegeu més avall) |

El secret es genera i es posa sense que surti per pantalla amb `scripts/preview-secret.sh`
(necessita la CLI de Vercel amb sessió iniciada). No s'escriu a cap fitxer.

**Deployment Protection de Vercel.** Per defecte les previsualitzacions demanen sessió de Vercel,
i la web rebria una pàgina d'accés en lloc de la resposta del CRM. Dues sortides, sense obrir res
al públic: (a) al projecte del CRM, *Settings → Deployment Protection → Protection Bypass for
Automation*, generar el secret i posar-lo a la web com a `CRM_PROTECTION_BYPASS` (Preview);
la web l'envia a la capçalera `x-vercel-protection-bypass`; o (b) desactivar *Vercel
Authentication* només mentre dura la prova. A producció no cal res: el domini de producció no
porta aquesta protecció i la ruta només accepta peticions signades.

Després de posar variables cal un *Redeploy* de cada previsualització.

## Fase 3 — Validació integral (una sola vegada, dades fictícies)

Des del repositori de la web:

```bash
WEB_URL=https://<previsualització de la web> node scripts/validate-integration.mjs
```

(`WEB_BYPASS=<secret>` si la web també està protegida.) Envia sis formularis: pressupost amb
configuració, visita del mateix client, informació d'una altra persona, MINERAL, un **segon
pressupost del primer client amb una altra configuració** i un reintent exacte d'aquest últim.

Després, al CRM de proves:

- [ ] Hi ha 3 clients i 3 projectes en `lead`; el primer client té **tres** sol·licituds al panell
      (pressupost, visita, segon pressupost) i el reintent no n'ha creat cap de nova.
- [ ] El panell «Sol·licituds de la web» mostra origen, referència, notes i tota la configuració.
- [ ] La visita surt «pendent de confirmar»; direcció la pot confirmar i descartar.
- [ ] Direcció ha rebut els avisos («Lead nou», «Nova sol·licitud web», «Visita per confirmar»).
- [ ] Arquitecte **no assignat**: no veu el projecte. Assignat: veu el panell sense imports ni botons.
- [ ] Client: no veu cap sol·licitud ni el panell.
- [ ] No s'ha creat cap pressupost.
- [ ] `https://<previsualització del CRM>/api/web/leads` amb un `POST` sense signar respon `401`.

En acabar: esborrar les dades de prova del projecte de proves (o el projecte sencer).

## Fase 4 — Producció (cal autorització expressa)

Requisits previs, tots dos del client:

- **Política de privacitat** publicada a la web (responsable, finalitat, base legal, conservació,
  drets i contacte). Avui la pàgina és buida. La web ho fa complir: mentre
  `PRIVACY_POLICY.published` sigui `false` (`src/content/site.ts`), producció no envia cap formulari.
- Còpia de seguretat de producció (`docs/02`).

Passos, en aquest ordre:

1. Fusionar `feature/web-leads-integration` a `main` del CRM. La ruta queda desplegada i apagada.
2. Aplicar `20261126001200_web_leads.sql` a la base de dades de producció.
3. Variables de **Production** al CRM (`WEB_LEADS_SECRET` nou, diferent del de proves;
   `WEB_LEADS_ENABLED=true`) i *Redeploy*.
4. Fusionar `redesign/cinematic-v5` a `main` de la web, amb `CRM_LEAD_URL`, `CRM_LEAD_SECRET` i
   `CRM_LEADS_ENABLED=true` a Production, i `SITE_URL` / `SITE_INDEXABLE=true` quan s'hagi de publicar.
5. Un formulari real de comprovació, i esborrar-lo.

Interruptors comercials de la web (tots apagats; cap canvia preus):

| Què | Com s'encén | Requisit |
|---|---|---|
| Recepció de leads | `CRM_LEADS_ENABLED=true` (web) + `WEB_LEADS_ENABLED=true` (CRM) | fases 1–3 i privacitat |
| Tarifa publicada pel CRM | `CRM_TARIFF_URL=https://<CRM>/api/configurador/tarifa` (web) | tarifa aprovada i publicada des del CRM (Administració › Tarifes › Publicar a la web) |
| Pressupostos orientatius | `PRICING_PUBLIC=true` (web) | l'anterior, i que direcció validi la tarifa en vigor |
| WhatsApp comercial | `WHATSAPP.enabled = true` a `src/content/site.ts` (web) | confirmar el número i qui l'atén |
| Àrea de clients | `CLIENT_AREA.enabled = true` i la URL definitiva del portal | domini del CRM i usuaris client actius |

Per aturar la recepció en qualsevol moment: treure `WEB_LEADS_ENABLED` del CRM i redesplegar.
