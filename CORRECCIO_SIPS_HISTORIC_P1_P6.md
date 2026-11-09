# Consum SIPS P1–P6: correcció de l'històric

## Què canvia

- El motor consulta primer l'històric real d'energia activa, separat en `EActivaP1` a `EActivaP6`. Suma cada columna independentment; no reparteix el consum total entre períodes.
- Paginació fins a recuperar la resposta completa; detecta pàgines repetides i identificadors de subministrament incorrectes.
- Prioritza `IdPuntoSuministro` sobre el camp genèric `Id`.
- Busca l'últim tram de dotze mesos amb cobertura completa. Admet lectures a mig mes i intervals amb límit final inclòs o exclusiu. No prorrateja intervals ni inventa zeros.
- Si l'històric falla o és incomplet, prova el resum anual existent. Només un desglossament complet i coherent passa a la comparativa. S'explica el motiu de la consulta alternativa.
- Els resums antics guardats es renoven amb la nova lectura. Els incomplets es poden reintentar cada quinze minuts, o immediatament amb l'actualització manual.
- La fitxa del client, a Subministraments, mostra el mateix detall SIPS persistent que s'utilitza en generar la comparativa, amb dates i total. Les dades manuals o de factura del subministrament es conserven: si tenen períodes, es mostren separadament dels consums SIPS. No s'ha canviat automàticament la taula `crm_supplies`; la lectura SIPS queda guardada a `sips_cache` com fins ara.
- La comparativa continua rebent P1–P3 per a 2.0TD i P1–P6 per a 3.0TD/6.xTD, amb el total i dates del mateix tram.
- Les rutes de cerca, actualització i vinculació permeten fins a 60 segons per incloure la consulta de detall.

## Servei verificat

S'ha inspeccionat el JavaScript públic d'EAS el 06/11/2026:
`https://eas.renovaenergy.es/Scripts/site/EAS.Web.js`.

`ConsumoPuntoSuministroService.baseUrl` és `Core/ConsumoPuntoSuministro`; el servei inclou `List`. La graella `ConsumoPuntoSuministroElectricidadGrid` filtra amb `setEquality('IdPuntoSuministro', value)`. El formulari declara `FechaInicioConsumo`, `FechaFinConsumo` i `EActivaP1` a `EActivaP6`.

La integració només llegeix `POST /Services/Core/ConsumoPuntoSuministro/List`, amb `EqualityFilter.IdPuntoSuministro`, `Skip`, `Take`, `Sort` i `IncludeColumns`. No executa ImportarCNMC ni modifica EAS.

## Comprovacions

`npm run test:sips-summary`: **55 proves passades**, amb Node 24.

Inclou històric en tres pàgines, ID explícit, decimals, P6, sessió caducada, pàgina repetida, dades d'un altre subministrament, buits, solapaments, dates a mig mes, memòria cau antiga i traspàs des de dades del client a la proposta. Les peticions autenticades es simulen: no s'ha consultat un CUPS real a EAS des d'aquest entorn.

`npm run typecheck`: no executat satisfactòriament perquè les dependències del ZIP no estan instal·lades (`tsc: not found`). Tampoc s'ha completat un build de Next.js o una verificació visual del CRM desplegat.

## Aplicació

Aquest ZIP conté el projecte complet actualitzat. Copia'n el contingut al repositori, mantenint les variables d'entorn existents. Executa la instal·lació de dependències, `npm run typecheck`, `npm run test:sips-summary` i `npm run build` al teu entorn habitual abans de publicar.

Després de desplegar, obre el CUPS afectat i actualitza el SIPS. Comprova que apareixen els sis consums i les dates correctes, genera la proposta des de la fitxa i comprova P1–P6 a Comparatives IA. Si l'històric real no cobreix dotze mesos, el CRM ho indicarà; no completarà els períodes inventant valors.

No s'ha desplegat aquest canvi al CRM en producció.

## Correcció de compilació

`loadSipsConsumption` retorna directament el resultat de l’actualització quan no hi ha entrada o cal renovar-la. La branca que reutilitza la memòria cau comprova explícitament que no sigui nul·la, resolent l’error TypeScript de `src/energy/api.ts:73` comunicat al desplegament.

Correcció addicional: la variable `entry` de `loadSipsConsumption` ara es declara amb `const`, resolent el bloqueig ESLint `prefer-const` del desplegament ca48f2c.
