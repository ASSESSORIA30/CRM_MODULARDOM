#!/usr/bin/env node
// ---------------------------------------------------------------------
// Còpia de tots els fitxers dels buckets privats de ModularDom CRM.
// Ús: node scripts/backup-storage.mjs backups/<data>/storage
// Variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PROJECT_REF
// Només s'executa en local (mai al navegador ni a Vercel).
// ---------------------------------------------------------------------
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadEnv, assertModulardom, BUCKETS, headers } from './storage-common.mjs';

loadEnv();
const { url, key } = assertModulardom();
const out = process.argv[2];
if (!out) { console.error('Indica la carpeta de destinació'); process.exit(1); }

async function list(bucket, prefix) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...headers(key), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${bucket}/${prefix}: ${r.status} ${await r.text()}`);
    const page = await r.json();
    items.push(...page);
    if (page.length < 1000) break;
  }
  const files = [];
  for (const it of items) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.id === null) files.push(...await list(bucket, path)); // carpeta
    else files.push(path);
  }
  return files;
}

let total = 0;
const manifest = {};
for (const bucket of BUCKETS) {
  const files = await list(bucket, '');
  manifest[bucket] = files;
  for (const path of files) {
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { headers: headers(key) });
    if (!r.ok) throw new Error(`download ${bucket}/${path}: ${r.status}`);
    const dest = join(out, bucket, path);
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
    await writeFile(dest, Buffer.from(await r.arrayBuffer()), { mode: 0o600 });
    total++;
  }
  console.log(`  ${bucket}: ${files.length} fitxers`);
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(`✔ ${total} fitxers copiats a ${out}`);
