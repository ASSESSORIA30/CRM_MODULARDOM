# Correcció SIPS: consum anual per períodes

## Canvi funcional

La cerca del CUPS ara consulta també el servei observat a Chrome Network:

- POST `/services/Core/PuntoSuministro/ResumenConsumosU12M`.
- Cos: `{ "idPuntoSuministro": <ID intern retornat per la cerca> }`.
- Reutilitza sessió, cookies i CSRF del servidor; reautentica una vegada si la sessió caduca.
- Demana `Id` i `IdPuntoSuministro` a la cerca. Si el proveïdor no retorna cap dels identificadors, conserva la cerca i mostra l'error de desglossament; mai inventa un ID.
- Respecta el CUPS complet de 22 caràcters, inclòs el sufix 0F. Un altre sufix no s'accepta com a coincidència exacta.

## Interpretació

- 2.0TD: P1–P3. 3.0TD i 6.1TD: P1–P6 (també 6.2TD–6.4TD).
- Suma els 12 valors de cada `EActivaMesP<n>`, amb decimals JSON, i contrasta el resultat amb `EActivaMes` i `EActiva`.
- Exigeix una finestra de 12 mesos consecutius informada amb `Año1`, `Mes1`, `Año12` i `Mes12`.
- Zero, camp absent i dada invàlida es distingeixen. No es reparteix el total anual artificialment.
- Un resum amb dades absents o discrepàncies internes superiors a 1 kWh es mostra amb avís i no s'importa al comparador com a desglossament validat.
- Una diferència respecte a l'anual del llistat s'avisa separadament: pot correspondre a una altra finestra temporal.
- Les dates representen la finestra del resum EAS. No s'afirma que siguin l'última lectura o factures mensuals completes: EAS pot distribuir intervals entre mesos. L'últim consum es deixa sense informar quan la resposta no el proporciona.

## Conservació i comparadors

- Es guarda el detall serialitzat dins del `raw` JSONB existent de `sips_cache` i es retorna com `annual_consumption` a l'API. No cal una migració nova de Supabase; es pressuposa l'esquema existent de la migració 004, amb `raw`.
- Les entrades antigues sense detall es poden renovar sense esperar el TTL. Les comparatives detecten aquest cas.
- El desglossament coherent es traspassa al comparador individual, a les comparatives massives i a Energy Market, amb dates i procedència.
- L'importador de dades SIPS ofereix els períodes com a camp propi i no marca per defecte la substitució de dades manuals o de factura. En importar els períodes, també adopta el total i la finestra corresponents.
- La proposta de renovació carrega automàticament els períodes en arribar les dades SIPS, sense un segon botó. «Actualitza SIPS» torna a omplir-los explícitament. Les factures o edicions manuals no es trepitgen per una resposta de fons.
- Vincular SIPS a un subministrament del CRM també incorpora `period_kwh` quan hi ha un desglossament validat.
- Les cerques per adreça mantenen la paginació actual i ofereixen «Consulta consums» a cada fila, per evitar desenes de peticions de resum automàtiques.
- El resum U12M retorna els arrays dels 12 mesos en una resposta: no necessita paginar l'històric. Si és incomplet, s'avisa. No s'ha afegit una crida d'històric `List` no documentada: la seva URL i el seu Payload encara no s'han facilitat.

## Verificació feta

`npm run test:sips-summary` (Node 24 o posterior, sense dependències externes): 31 proves passades.

Inclou petició HTTP simulada amb ID dinàmic, CSRF i cookies; renovació de sessió; persistència en raw i relectura; traspàs al comparador; tres/sis períodes; P6 absent; zeros; decimals; dates; any de traspàs; discrepàncies; protecció de dades manuals; rebuig d'altres sufixos; i càlcul comercial amb preus P1–P6 i SAS.

El cas històric verificat amb les dades reals de juliol 2025–juny 2026 retorna:

| Període | kWh |
|---|---:|
| P1 | 1629 |
| P2 | 1958.168 |
| P3 | 1377.043 |
| P4 | 1324 |
| P5 | 750 |
| P6 | 5842.789 |
| Total | 12881 |

Aquestes xifres són fixtures de prova, no valors fixats al motor.

## Límits de verificació i aplicació

No s'ha fet una consulta real nova del servei des d'aquest servidor ni un desplegament. La URL i el Payload provenen de les captures aportades. Cal validar al desplegament el nom efectiu de l'ID a la resposta de cerca i la resposta completa P1–P6 del proveïdor.

`npm run typecheck` no s'ha pogut executar: aquest entorn no té instal·lades les dependències del projecte (`tsc: not found`). Tampoc es declara passada la compilació Next.js ni una prova visual del CRM.

Per aplicar el canvi: actualitza el repositori amb el contingut d'aquest ZIP, conserva les variables SIPS del servidor i executa les comprovacions i el build del projecte al seu entorn habitual. Després actualitza el CUPS des del CRM per omplir el detall de les dades antigues.

No s'han modificat dades del portal EAS ni afegit credencials al paquet.

## Actualització: emplenat automàtic i radiografia

- «Consulta el SIPS» de les comparatives omple els períodes i el total amb el mateix tram temporal.
- Les dades noves consultades a SIPS/radiografia es propaguen a la comparativa oberta quan el consum és buit o té origen SIPS/CRM. Les edicions manuals i de factura queden protegides.
- La proposta de renovació consulta el detall si encara no existeix i omple automàticament els camps P1–P3 o P1–P6. També controla les respostes tardanes en canviar de contracte.
- «Omple amb el SIPS» del subministrament del client recupera també `period_kwh`, amb decimals, i el total corresponent.
- Radiografia i fitxa tècnica mostren una taula de períodes amb kWh, total, dates, origen i avisos. La radiografia renova les entrades antigues sense detall encara que el total anual estigui en memòria cau.
- La pestanya d'energia del contracte i les targetes dels subministraments del client també mostren els períodes.
- Energy Market selecciona el consum real SIPS automàticament en arribar, sense canviar una selecció manual de l'usuari.
- Els informes PDF energètics incorporen el consum per períodes i les dates. El total de referència de l'anàlisi utilitza la suma validada dels períodes quan existeix.
- La consulta compartida dels formularis recupera les entrades antigues que encara només tenien el total; es conserva el CUPS complet amb sufix.
- Noves proves de la regla d'emplenat automàtic, protecció d'edicions, coherència del total de radiografia i obtenció del detall per la consulta compartida. Total: 31 proves passades amb portal simulat.

La verificació de la interfície al desplegament real i la compilació completa continuen pendents perquè aquest entorn no té les dependències Next.js/TypeScript instal·lades. No s'ha desplegat el projecte.

## Correcció v4: filtres i ordenació locals

Aquesta secció substitueix el comportament anterior del filtre de resultats.

- «Aplica filtres» només modifica l'estat local de la pantalla. No crida l'API del CRM ni el portal EAS.
- «Neteja filtres» recupera els mateixos resultats originals carregats, sense consultar de nou SIPS.
- Les capçaleres de consum, tarifa, subministrament, comercialitzadora i última lectura ordenen localment la llista, en els dos sentits.
- Els filtres inclouen text (CUPS, adreça, població o comercialitzadora), tipus, tarifa i rang de consum anual.
- El text ignora majúscules i accents. Les tarifes RL2, RL.2 i RL 2 són equivalents. Les tarifes s'ordenen de manera natural (RL2 abans de RL10).
- Els consums absents no es converteixen en zero. L'ordenació situa les dades absents al final en els dos sentits.
- La importació en bloc utilitza només els registres visibles després de filtrar. Aplicar o netejar un filtre elimina les seleccions anteriors per evitar importar files amagades.
- Les dades originals no es modifiquen. La pantalla indica quants registres són visibles, quants hi ha carregats i el total informat pel portal.
- Abast: la pàgina de resultats ja carregada (habitualment 50 files). «Anterior» i «Següent» continuen carregant una altra pàgina del portal; conserven els filtres locals i l'ordre. No es descarreguen totes les pàgines automàticament.
- El formulari principal «Buscar» continua fent una consulta explícita a SIPS. Els controls de filtratge dels resultats no hi tornen a buscar.

Verificació: 36 proves del motor passades. La prova de regressió simula una consulta inicial, aplica filtres, els neteja i ordena els resultats; comprova que el nombre de peticions es manté en una sola. També es comproven la immutabilitat de les dades originals, accents, variants RL, zeros, absències i els dos sentits d'ordre.

La compilació completa i la comprovació visual del CRM al desplegament real continuen pendents en aquest entorn sense les dependències Next.js/TypeScript instal·lades.

Aquest ZIP v4 conté únicament els fitxers nous o modificats respecte a v3. S'ha de copiar sobre el projecte que ja té v3, mantenint les carpetes.


## v5: totes les propostes a Comparatives IA

- Els botons de proposta de contractes, renovacions, targetes, inici i agrupacions obren el mateix assistent de Comparatives IA. L'assistent antic queda substituït per una redirecció compatible.
- «Genera proposta» també està disponible als resultats SIPS i a la radiografia, encara que el CUPS no tingui un contracte al CRM.
- L'entrada omple el client i les dades disponibles del subministrament: CUPS complet amb sufix, adreça, contacte, comercialitzadora, tarifa, potències, consum anual i desglossament validat P1–P6 (P1–P3 en 2.0TD). Gas conserva el consum anual.
- Amb diversos subministraments actius al client, un selector permet triar el CUPS de la proposta.
- Les propostes iniciades des d'una lectura de factura de captació també van a Comparatives IA i aprofiten les dades i els preus llegits, amb les seves hipòtesis d'anualització.
- Els valors manuals i de factura es conserven. Els camps desconeguts i els preus no disponibles queden pendents de completar.
- Les entrades mantenen el vincle amb el contracte, client, subministrament o oportunitat corresponent. Les navegacions respecten la protecció existent de canvis sense desar.
- No s'ha modificat cap dada del portal EAS ni s'ha desplegat el CRM.

Verificació: 43 proves passades amb Node 24. Inclou tarifa de sis períodes, 2.0TD, gas, protecció de valors, absències i ruta comuna amb el sufix del CUPS. La compilació completa i la prova visual al CRM desplegat continuen pendents perquè falten les dependències del projecte en aquest entorn.

Aquest ZIP v5 conté només els fitxers nous o modificats respecte a v4. Copia'ls sobre el projecte actual amb v4 aplicada, respectant les carpetes.


## v6: equivalència de tarifes antigues de gas als filtres

- Els filtres reconeixen 3.1 com RL1, 3.2 com RL2, 3.3 com RL3, etc. (3.n ↔ RL.n, n d'1 a 11), incloses les variants RL2, RL.2 i RL 2.
- L'ordenació per tarifa utilitza la mateixa equivalència. Les tarifes de llum 3.0TD i 6.1TD es mantenen diferenciades.
- Aplicar, netejar o ordenar filtres continua operant només sobre els resultats carregats, sense consultar de nou SIPS. La cerca principal explícita també inclou les denominacions antigues.
- No es modifiquen els registres d'origen ni s'infereixen tarifes a partir del consum.

Verificació: 46 proves passades. Compilació completa i prova visual al desplegament pendents. Aquest ZIP conté només els fitxers canviats o nous respecte a v5; cal aplicar-lo sobre v5.
