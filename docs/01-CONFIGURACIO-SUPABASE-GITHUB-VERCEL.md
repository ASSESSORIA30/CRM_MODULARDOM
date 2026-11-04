# Configuració d'infraestructura independent — ModularDom CRM

> **Regla absoluta:** cap pas d'aquesta guia toca els projectes d'Assessoria 3.0.
> Abans de copiar qualsevol clau, comprova que a la barra superior de Supabase
> hi diu **ModularDom / modulardom-crm**.

---

## A. Supabase — crear el projecte nou

### A1. Organització pròpia (recomanat)
1. Entra a <https://supabase.com/dashboard>.
2. Selector d'organització (dalt a l'esquerra) → **New organization**.
3. Nom: `ModularDom`. Tipus: *Company*. Pla: el que decidiu (vegeu A7 sobre còpies).
   *Així la facturació, els membres de l'equip i els projectes queden separats d'Assessoria 3.0.*

### A2. Projecte
1. Dins de l'organització `ModularDom` → **New project**.
2. **Name:** `modulardom-crm`
3. **Database password:** genera'n una de forta i guarda-la al gestor de contrasenyes
   (no la enviïs per correu ni la posis al repositori).
4. **Region:** una regió de la UE (p. ex. *Central EU (Frankfurt)* o *West EU (Paris)*), per protecció de dades.
5. **Create new project** i espera que acabi l'aprovisionament.

### A3. Autenticació
**Authentication → Sign In / Providers**
- *Allow new users to sign up* → **desactivat** (els usuaris els crea direcció).
- Proveïdor **Email** → activat, *Confirm email* → activat.

**Authentication → URL Configuration**
- *Site URL:* l'URL de producció de Vercel (de moment `http://localhost:3000`).
- *Redirect URLs:* `http://localhost:3000/**` i, quan el tingueu, `https://<domini-vercel>/**`.

### A4. API
**Project Settings → Data API** → *Exposed schemas*: deixa només `public`.

### A5. Aplicar les migracions
Opció 1 — Supabase CLI (recomanada):
```bash
npm i -g supabase            # o: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <REF_DEL_PROJECTE_MODULARDOM>
supabase db push             # aplica supabase/migrations/* en ordre
```
Opció 2 — **SQL Editor**: enganxa i executa cada fitxer de `supabase/migrations/`
en ordre (0100 → 0200 → 0300 → 0400).

Comprovació: **Table Editor** ha de mostrar les taules amb l'etiqueta RLS activada,
i **Storage** els 6 buckets (`contractes`, `pressupostos`, `factures`, `planols`,
`fotografies`, `documents`) marcats com a privats.

### A6. Primer usuari de direcció
1. **Authentication → Users → Add user → Create new user** amb l'email de direcció
   (marca *Auto Confirm User*).
2. **SQL Editor:**
   ```sql
   update public.profiles
      set role = 'direccio', is_active = true, full_name = '<Nom>'
    where email = '<email-direccio>';
   ```
   Tots els altres usuaris es crearan i activaran des del CRM.

### A7. Còpies de seguretat automàtiques
**Database → Backups**: comprova quines còpies automàtiques inclou el vostre pla i,
si cal, activa *Point in Time Recovery*. A més, feu servir els scripts del repositori
(vegeu `docs/02-COPIES-I-RESTAURACIO.md`), que també copien els fitxers de Storage.

---

## B. Credencials que heu de copiar

| Variable | On es troba a Supabase | On va |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → *Project URL* | `.env.local` i Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → *Publishable key* (`sb_publishable_…`) | `.env.local` i Vercel |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → *Secret keys* (`sb_secret_…`) | `.env.local` i Vercel (**sense** `NEXT_PUBLIC_`) |
| `SUPABASE_PROJECT_REF` | Project Settings → General → *Project ID* | `.env.local` i Vercel |
| `SUPABASE_DB_URL` | Botó **Connect** → *Session pooler* (amb la contrasenya d'A2) | **només** `.env.local` per a backups |

Si el projecte només mostra claus antigues (*Legacy API keys*): `anon` va a
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` i `service_role` a `SUPABASE_SECRET_KEY`.

**Per enviar-me la configuració** només necessito la **Project URL** i el **Project ID**
(no són secrets). **No m'envieu** la secret key, la service_role ni la contrasenya de la base
de dades: les poseu vosaltres directament a `.env.local` i a Vercel.

---

## C. GitHub — repositori privat
1. <https://github.com/new>
2. *Owner:* el compte o organització de ModularDom. *Repository name:* `modulardom-crm`.
3. Visibilitat **Private**. No afegiu README ni .gitignore (ja hi són).
4. Pugeu el codi:
   ```bash
   cd modulardom-crm
   git remote add origin git@github.com:<owner>/modulardom-crm.git
   git push -u origin main
   ```
5. *Settings → Branches*: protegiu `main` (pull request obligatori).
6. *Settings → Code security*: activeu **Secret scanning** i **Push protection** si el pla ho permet.

## D. Vercel — projecte independent
1. <https://vercel.com/new> → **Import Git Repository** → `modulardom-crm`
   (concediu a la GitHub App de Vercel accés només a aquest repositori).
2. Feu-ho dins d'un *team/scope* de ModularDom, no dins del d'Assessoria 3.0.
3. *Framework:* Next.js (es detectarà quan hi hagi l'aplicació).
4. **Settings → Environment Variables**, per a *Production* i *Preview*:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` (marqueu-la com a *Sensitive*), `SUPABASE_PROJECT_REF`,
   `NEXT_PUBLIC_SITE_URL`. **No** hi poseu `SUPABASE_DB_URL`.
5. Un cop tingueu el domini, afegiu-lo a Supabase (pas A3, *Site URL* i *Redirect URLs*).

---

## E. Verificació local
```bash
cp .env.example .env.local      # i ompliu-lo
scripts/check-secrets.sh        # cap secret al repositori
scripts/test-db-local.sh        # migracions + proves RLS + backup/restauració en Postgres local
```
