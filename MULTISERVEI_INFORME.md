# Contractació multiservei · informe de lliurament

Branca: `feature/contractacio-multiservei` (parteix de `fix/lector-iberdrola-definitiu`). Migració nova: **039** (+ `_down`).

## Què hi ha
- **«Nou contracte»** amb 9 targetes: Electricitat, Gas natural, Fibra, Mòbil, Fibra + mòbil, Assegurances, Alarmes, Plaques solars i Altres serveis.
  Electricitat i gas obren el formulari d'energia de sempre (CUPS, tarifa, renovacions), sense canvis de comportament.
- **Formularis per passos** (Enrere / Desar esborrany / Crear contracte), validació en temps real, resum final i recuperació d'esborrany del navegador.
  - Fibra: titular (autocompletat sense trepitjar), operador O2/DIGI/Movistar/Orange/Vodafone/altres, producte, operació, velocitat, FTTH/HFC, adreça, fix i portabilitat, referència, quota, promoció, alta/instal·lació, permanència, penalització i dates.
  - Mòbil: diverses línies, cadascuna amb tarifa, preu, estat i identitat pròpia; total = línies vives.
  - Fibra + mòbil: preu del paquet; les línies «incloses» no es tornen a sumar; estalvi respecte de contractar-ho per separat.
  - Assegurances: companyia, tipus, pòlissa, prima anual, periodicitat, efecte, venciment, renovació automàtica, preavís. El proper rebut no és el venciment.
  - Alarmes: empresa (SEGURMA…), equips, central receptora, permanència i incidències.
  - Plaques solars: kWp, plaques, inversor, bateria, producció, excedents, pressupost, finançament, calendari de pagaments (ha de quadrar), fases d'obra, garanties i manteniment. Sense renovació anual.
- **Mateix sistema de contractes** (`crm_contracts`): columnes `service`, `details`, `permanence_end`, `monthly_eur`, `provider_ref`, `collaborator_id`. Línies a `crm_contract_lines`. Historial d'estats automàtic a `crm_contract_events` (no s'esborra). Els serveis que no són d'energia mai s'enllacen a un CUPS i mai es publiquen a Renovacions.
- **Fitxa 360°**: serveis agrupats amb icona i estat, filtres per servei, proveïdor, estat i venciment/permanència, línies, avisos, historial, documents per contracte (magatzem privat amb els permisos de sempre) i estat de la comissió.
- **Comissions**: regles per proveïdor/producte a `fin_service_rules` (Economia → Regles): fix per alta, % de quota, recurrent, per línia, per paquet, per instal·lació, per kWp, condicionada a activació, retrocessió i part del col·laborador. Només Direcció les crea i aprova. La comissió prevista es recalcula en desar; mai es marca cobrada sense data real ni liquidada sense referència.

## Proves
- `tests/multiservei.test.ts` (17) + `tests/db/multiservei-rls.test.ts` (8, PostgreSQL real amb PGlite).
- Suite completa: 97 fitxers, 1432 proves correctes. Typecheck correcte, lint sense errors, build de producció correcte.
- Tot provat **amb simulació** (PGlite i Supabase en memòria). No s'ha provat contra el Supabase real.

## Limitacions
- Els documents s'adjunten un cop creat el contracte (no dins del formulari).
- Els contractes multiservei encara no entren a les liquidacions automàtiques d'energia: la «liquidada» es vincula amb la referència de la liquidació real.
- El catàleg de productes per operador és text lliure amb suggeriments (no hi ha tarifari d'operadors).
