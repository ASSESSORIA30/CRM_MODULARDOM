# Model de permisos (base de dades)

Els permisos s'apliquen a PostgreSQL amb RLS. La interfície només amaga el que la base
de dades ja denega. Usuari nou = inactiu fins que direcció l'activa. Desactivar un usuari
(`profiles.is_active = false`) o revocar l'assignació (`project_members.revoked_at`)
talla l'accés immediatament, inclosos els fitxers.

| Recurs | Direcció | Arquitecte | Constructor | Client |
|---|---|---|---|---|
| Projectes | tots (CRUD) | assignats (lectura) | assignats (lectura) | els seus (lectura) |
| Clients | tots | titulars dels seus projectes | cap | la seva fitxa |
| `project_financials` (vendes, costos, marges) | tot | **cap** | **cap** | **cap** |
| Documents `factures` | tots | **mai** | **mai** | les seves, publicades i vigents |
| Documents `contractes` / `pressupostos` | tots | si direcció els marca visibles | **mai** | publicats i vigents |
| Documents `planols` / `fotografies` / `documents` | tots | marcats visibles + els que ha pujat | marcats visibles + els que ha pujat | publicats i vigents |
| Pujar fitxers | tots els buckets | `planols`, `fotografies`, `documents` dels seus projectes | `fotografies`, `documents` de les seves obres | no (fase 5: missatgeria) |
| Publicar al client | sí | no | no | — |
| Canviar rol / activar usuaris | sí | no | no | no |
| Auditoria | lectura | no | no | no |
| Leads, Kanban, clients | tot | titulars dels seus projectes | no | la seva fitxa |
| Canviar d'etapa | sí (amb validacions) | no | no | no |
| Passos del projecte | tots | 5, 7, 8, 9, 10 dels seus projectes | no | no |
| Activitats | tot | llegir i afegir als seus projectes | no | no |
| Tasques | tot | les assignades (només l'estat) + crear tècniques | les assignades (només l'estat) | no |
| Calendari | tot | com a responsable/assistent + crear als seus projectes | com a responsable/assistent | cites confirmades i publicades del seu projecte |
| Notificacions | les seves | les seves | les seves | les seves |

La clau secreta (`SUPABASE_SECRET_KEY`) salta l'RLS i només s'usa al servidor
(`src/lib/supabase/admin.ts`, protegit amb `server-only`).
