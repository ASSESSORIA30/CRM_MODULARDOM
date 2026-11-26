# Pressupostos del configurador web i cobertes

Continuació de `docs/09` (leads) i `docs/10` (activació). Mateix secret, mateixa signatura i mateix
interruptor (`WEB_LEADS_ENABLED`): **no hi ha variables d'entorn noves**.

## 1. Cobertes

- Coberta plana: estàndard, sense partida. Inclinada d'una aigua i a dues aigües: suplement per
  **m² de coberta** (no de superfície construïda).
- Els preus i els paràmetres són a la tarifa (*Administració › Tarifes*, bloc «Cobertes inclinades»):
  preu €/m² i pendent % de cada tipus, voladís per costat (m) i proporció de la planta.
  Cal omplir-los tots sis o cap. **Una tarifa sense aquest bloc no valora cobertes inclinades**:
  el configurador les mostra «pendents de valorar» i no les suma.
- Sense plànols, la superfície s'estima: planta = m² construïts ÷ plantes; rectangle amb la proporció
  indicada; més el voladís a cada costat; projectat sobre el pendent (× √(1 + pendent²)).
  Sempre s'indica que és **estimada**. Al configurador intern es pot escriure la superfície
  **mesurada** i llavors no s'estima res.
- Les tarifes aprovades no es modifiquen: per activar les cobertes cal un esborrany nou amb el bloc
  omplert, aprovar-lo i publicar-lo. Les configuracions antigues (sense plantes ni coberta) valen per
  «una planta, coberta plana» i donen el mateix import que abans.

## 2. Què passa quan un visitant descarrega el pressupost

`POST /api/web/quotes` → `web_register_quote()` (una transacció):

1. Client i oportunitat amb les regles de `docs/09` (correu / telèfon; no fusiona res).
2. Pressupost a `web_quotes`. Mateixa configuració + mateixa tarifa + mateix client = **el mateix
   pressupost**: conserva la referència original i només es registra la descàrrega
   (`web_quote_downloads`, una per identificador de petició: un reintent no compta dues vegades).
   Configuració o tarifa diferents = **versió nova**; les anteriors no es toquen ni es recalculen.
3. Una tasca «Seguiment pressupost web» per oportunitat (no se'n crea cap altra mentre n'hi hagi
   una d'oberta), assignada al responsable del projecte si en té.
4. Un enllaç privat de recuperació: 64 caràcters aleatoris, vàlid 90 dies, revocable. A la base de
   dades només se'n desa el hash.

Després la web genera el PDF i el desa (`PUT /api/web/quotes/pdf`) al bucket privat
`pressupostos-web`. Només es desa el primer: el document original és el que val. Si qualsevol pas
falla, la web no lliura cap PDF.

No es crea mai un pressupost definitiu (`quotes`): els imports són orientatius.

## 3. Al CRM

- **Fitxa del client i del projecte → «Pressupostos del configurador web»**: referència, versió,
  data, tarifa, total, terreny, municipi, descàrregues, si ha demanat visita, desglossament amb IVA,
  PDF descarregable, estat comercial (nou, contactat, en negociació, acceptat, descartat) i
  «Revocar enllaços del client». Només direcció (són imports).
- **Clients › Projectes / leads**: filtre «Configurador web» (amb pressupost, amb terreny, ha demanat
  visita) i marques a cada fila amb el total de la darrera versió.
- El responsable s'assigna a la fitxa del projecte, com sempre.
- **Visita des del pressupost**: entra a «Sol·licituds de la web» pendent de confirmació, lligada al
  mateix client i oportunitat, sense tornar a demanar dades.

## 4. Seguretat

- `web_register_quote`, `web_recover_quote`, `web_quote_request_visit` i `web_quote_set_pdf`: només
  `service_role`. `web_quotes`: lectura per a direcció; ningú hi escriu des de l'API.
- La recuperació no retorna cap dada personal. L'enllaç porta el codi al fragment de l'adreça
  (`#r=…`), que el navegador no envia als servidors, i la web el treu de la barra en llegir-lo.
- El PDF del client només surt del bucket a través del servidor: amb sessió de direcció
  (`/api/pressupostos-web/<id>/pdf`) o amb un enllaç vigent, via la web.

## 5. Migració i proves

- `20261127001300_web_quotes.sql` (després de `20261126001200`). Només afegeix: tres taules, sis
  funcions i un bucket. Aplicar-la primer al projecte de proves.
- `npm test` (motor de cobertes), `npm run test:db` (`09_web_quotes_test.sql`).

## 6. Web antiga

`public/configurador/motor.js` i la còpia `web-integracio/assets/motor.js` s'han regenerat amb el
motor nou. És compatible: amb les configuracions de la web antiga dona exactament els mateixos
imports. **No cal tornar a pujar res a la web antiga**, i no s'hi ha tocat res.
