# Integració web → CRM: recepció de sol·licituds

La web nova (`modulardom-web`, branca `redesign/cinematic-v5`) envia cada formulari al CRM, de
servidor a servidor. **Està preparada i desactivada**: fins que no es configurin les variables de
la secció 6, la ruta respon `404` i no toca la base de dades.

## 1. Contracte

`POST /api/web/leads` · `Content-Type: application/json` · cos de 16 kB com a màxim.

| Capçalera | Valor |
|---|---|
| `X-ModularDom-Timestamp` | segons Unix del moment de l'enviament |
| `X-ModularDom-Signature` | hex de `HMAC-SHA256("<timestamp>.<cos>", secret)` — sobre el cos tal com s'envia |
| `Idempotency-Key` | 64 hex. Identifica **una sol·licitud**, no una persona: `sha256(correu \| 9 últims dígits del telèfon \| tipus \| dia \| contingut)` |

Cos (qualsevol camp que no surti aquí es rebutja):

```jsonc
{
  "reference": "W261126-AB3K",           // referència que la web ha donat al client
  "capturedAt": "2026-11-26T20:00:00.000Z",
  "source": "configurador",              // "web" | "configurador"  → clients.lead_source
  "kind": "quote",                       // info | quote | visit | mineral
  "page": "/ca/configurador",            // o null
  "client":  { "kind": "persona", "display_name": "…", "email": "…", "phone": "…", "locale": "ca", "city": null },
  "project": { "municipality": null, "plot_address": null, "surface_m2": 180 },
  "configurator": null,                  // o { input, visual, tariff, totalCents }
  "notes": "…",
  "visitor": "…"                         // opcional: pseudònim del visitant (32 hex), només per al límit de peticions
}
```

`configurator.input` és el `ConfigInput` del motor (`src/lib/configurator/engine.ts`);
`visual` són les tries del model 3D (plantes, sistema, façana, coberta, volum); `tariff` i
`totalCents` són el número de tarifa i l'import orientatiu que la web ha mostrat, o `null` si no
n'ha mostrat cap.

| Resposta | Quan |
|---|---|
| `201 {"id"}` | sol·licitud creada |
| `200 {"id","duplicate":true}` | ja s'havia rebut (mateixa clau o mateixa signatura); no es crea res |
| `400` | JSON o clau d'idempotència mal formats |
| `401` | signatura absent o incorrecta, o timestamp de més de 5 minuts |
| `413` / `415` | cos massa gran / no és JSON |
| `422 {"fields"}` | el cos no compleix el contracte |
| `429` | límit de peticions (30/min per IP, 600/h en total, 8/h per visitant de la web) |
| `404` | integració desactivada |
| `500` / `503` | error intern; la web ho tracta com a «no enviat» i no confirma res al client |

## 2. Què fa el CRM amb cada sol·licitud

Tot passa dins de `public.web_create_lead()` (una sola transacció: o es crea tot o no es crea res).

1. **Idempotència.** La clau i la signatura són úniques a `web_lead_intake`. Una repetició retorna
   la primera entrada. Dues peticions simultànies amb la mateixa clau: només una crea.
   La clau inclou el contingut de la sol·licitud: un reintent (doble clic, tall de xarxa) porta la
   mateixa clau i es descarta; una **altra** sol·licitud del mateix client el mateix dia (una altra
   configuració, un altre missatge, un altre tipus) porta una clau diferent i entra com a nova,
   afegida al seu client i a la seva oportunitat oberta.
2. **Client.** Es busca per correu (minúscules) i per telèfon (9 últims dígits), les mateixes regles
   que `find_client_duplicates`, sense comptar clients fusionats.
   - cap coincidència → client nou, amb `lead_source` = origen;
   - un sol client → **es conserven les seves dades** i s'hi afegeix la sol·licitud;
   - coincidències contradictòries (el correu és d'un client i el telèfon d'un altre, o n'hi ha
     més d'un) → **no es fusiona res**: es crea un client nou, es desen els candidats a
     `match_candidates` i direcció rep l'avís «Possible client duplicat».
3. **Projecte.** Si el client ja té una oportunitat oberta (`lead` o `pressupost`), la sol·licitud
   s'hi afegeix. Si no, es crea un projecte en `lead` com ho fa `create_lead`: codi `MD-AAAA-NNNN`,
   titular principal, historial d'etapa, els 11 passos, municipi, adreça del terreny i superfície.
   Si la web ha mostrat un import, queda com a **estimació** (`project_financials.estimated_sale_cents`).
   **No es crea mai cap pressupost.**
4. **Activitat** al fil del projecte amb el tipus, la referència web i les notes del client.
5. **Avisos** a direcció: «Lead nou» (el del CRM, si hi ha projecte nou), «Nova sol·licitud web»
   (si s'ha afegit a un projecte existent) i «Visita per confirmar».

| Tipus | Acció següent del projecte | Particularitat |
|---|---|---|
| `info` | Contactar: sol·licitud d'informació | — |
| `quote` | Preparar pressupost (configuració web) | porta la configuració sencera |
| `visit` | Confirmar visita a la casa pilot | `visit_status = pendent_confirmacio`; **no** es crea cap cita al calendari |
| `mineral` | Contactar: consulta MINERAL | client `empresa` si la web n'ha rebut el nom |

## 3. On es veu al CRM

- **Fitxa del projecte → «Sol·licituds de la web»**: origen, tipus, referència, pàgina, notes i la
  configuració completa (superfície, habitacions, banys, suite, cuina, garatge, safareig,
  instal·lacions, extres i les tries del model 3D). Direcció hi veu també l'import orientatiu i hi
  confirma o descarta les visites. L'arquitecte assignat veu la configuració, sense imports.
- **Clients**: l'origen (`Web` / `Configurador web`) surt a la llista i a la fitxa, com fins ara.
- Responsables, seguiment, tasques, calendari i avisos són els de sempre: un lead web és un lead.

## 4. Seguretat

- El secret (`WEB_LEADS_SECRET`) només viu a les variables de servidor dels dos projectes. Cap
  variable `NEXT_PUBLIC_`. `npm run check:secrets` continua vigilant-ho.
- `web_create_lead` i `web_rate_hit` només les pot executar `service_role`; `anon` i els usuaris
  autenticats (direcció inclosa) reben un error. Ningú pot inserir a `web_lead_intake` directament.
- `anon` continua sense cap privilegi sobre `clients`, `projects` ni cap altra taula.
- El límit de peticions és a la base de dades (`app.web_rate_limits`), no a la memòria del servidor.
  Inclou un límit per visitant de la web: la web envia, dins del cos signat, un pseudònim de
  l'adreça del visitant (HMAC amb el secret; el CRM no veu mai l'adreça i no desa el pseudònim).
  És la protecció antispam persistent dels formularis: no depèn de cap servei de pagament.
- La bústia la llegeix direcció i l'arquitecte assignat al projecte (RLS).

### Tarifa publicada (`/api/configurador/tarifa` i `tarifa.js`) — revisió

No s'ha canviat res: ni rutes ni preus. El que publiquen és exactament
`web_published_tariff()`: número, dates i `params` de la darrera tarifa aprovada i publicada.
No hi ha camps de cost ni de marge, ni esborranys, ni historial (la taula `tariff_versions` no és
llegible per `anon`). **A tenir present:** `params` inclou tots els preus unitaris de venda,
també el bloc `intern` (habitació, bany, suite, safareig) i el percentatge de descompte de
distribució, perquè la web antiga calcula al navegador. Són preus de tarifa, no costos; però
qualsevol els pot llegir. La web nova calcula al servidor i no els exposa. Quan la web antiga es
retiri, la lectura anònima es pot tancar (revocar `anon` de `web_published_tariff` i fer que la
ruta demani un secret); avui trencaria `www.modulardom.com/presupuesto`.

## 5. Proves

- `npm test` — signatura, finestra de temps i esquema (`src/lib/web-leads/verify.test.ts`).
- `npm run test:db` — `supabase/tests/08_web_leads_test.sql`: permisos, alta completa,
  idempotència, client existent, coincidències contradictòries, visites, límit de peticions.
- Prova integral feta amb dades fictícies i Postgres local: web V5 real → `/api/web/leads` →
  base de dades, amb els quatre tipus, signatures dolentes, repeticions i concurrència.
  No s'ha fet contra Supabase ni contra producció.

## 6. Activació (quan direcció ho aprovi)

1. Aplicar la migració `20261126001200_web_leads.sql` (primer en un projecte de proves).
2. Generar un secret: `openssl rand -hex 32`. No s'ha de desar enlloc més que a Vercel.
3. Variables d'entorn (Production; marcar els secrets com a *Sensitive*; després, *Redeploy*):

   | Projecte | Variable | Valor |
   |---|---|---|
   | CRM | `WEB_LEADS_SECRET` | el secret (mínim 32 caràcters) |
   | CRM | `WEB_LEADS_ENABLED` | `true` |
   | Web | `CRM_LEAD_URL` | `https://<domini del CRM>/api/web/leads` |
   | Web | `CRM_LEAD_SECRET` | el mateix secret |
   | Web | `CRM_LEADS_ENABLED` | `true` |

   El CRM ja ha de tenir `SUPABASE_SECRET_KEY` (vegeu `docs/01`).
4. Validació integral: enviar un formulari de cada tipus des de la web amb dades de prova,
   comprovar-los al CRM i esborrar-los.

Per aturar-ho: treure `WEB_LEADS_ENABLED` al CRM (o `CRM_LEADS_ENABLED` a la web). La web deixa
d'enviar i mostra al client que la sol·licitud no s'ha pogut enviar; no en perd cap en silenci.
Per canviar el secret: posar-ne un de nou als dos projectes i redesplegar-los.
