-- =====================================================================
-- 0900 · Documents del projecte: contracte signat i factures
-- Tipus i mides admesos per pujar contractes, factures i documentació general.
-- Només direcció hi pot pujar fitxers (polítiques de Storage existents) i
-- decideix què es publica al client (published_to_client + status vigent).
-- =====================================================================
insert into public.upload_rules (bucket_id, extension, mime_type, max_bytes, previewable) values
  ('contractes', 'pdf',  'application/pdf', 26214400, true),
  ('contractes', 'jpg',  'image/jpeg',      26214400, true),
  ('contractes', 'jpeg', 'image/jpeg',      26214400, true),
  ('contractes', 'png',  'image/png',       26214400, true),
  ('contractes', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 26214400, false),
  ('factures',   'pdf',  'application/pdf', 26214400, true),
  ('factures',   'jpg',  'image/jpeg',      26214400, true),
  ('factures',   'jpeg', 'image/jpeg',      26214400, true),
  ('factures',   'png',  'image/png',       26214400, true),
  ('documents',  'pdf',  'application/pdf', 26214400, true),
  ('documents',  'jpg',  'image/jpeg',      26214400, true),
  ('documents',  'jpeg', 'image/jpeg',      26214400, true),
  ('documents',  'png',  'image/png',       26214400, true),
  ('documents',  'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 26214400, false),
  ('documents',  'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 26214400, false)
on conflict (bucket_id, extension) do nothing;
