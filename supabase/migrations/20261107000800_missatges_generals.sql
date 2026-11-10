-- =====================================================================
-- 0800 · Missatges generals del projecte (apartat "Missatges" del portal)
-- Un comentari pot no estar vinculat a cap document, punt ni marcador:
-- és la conversa general entre client, arquitecte i direcció.
-- Les polítiques existents ja hi apliquen (compartit/intern, accés per projecte).
-- =====================================================================
alter table public.comments drop constraint comment_target;
create index comments_general_idx on public.comments (project_id, created_at)
  where document_id is null and item_id is null and annotation_id is null;
