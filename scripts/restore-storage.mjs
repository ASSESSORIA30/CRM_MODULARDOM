#!/usr/bin/env node
// ---------------------------------------------------------------------
// Restaura els fitxers copiats per backup-storage.mjs.
// No sobreescriu mai fitxers existents (x-upsert: false).
// Ús: node scripts/restore-storage.mjs backups/<data>/storage
// ---------------------------------------------------------------------
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { loadEnv, assertModulardom, BUCKETS, headers } from './storage-common.mjs';

loadEnv();
const { url, key } = assertModulardom();
const src = process.argv[2];
if (!src) { console.error('Indica la carpeta de la còpia de storage'); process.exit(1); }

const MIME = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
let ok = 0, skipped = 0;
for (const bucket of BUCKETS) {
  for (const path of manifest[bucket] ?? []) {
    const body = await readFile(join(src, bucket, path));
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...headers(key), 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'x-upsert': 'false' },
      body,
    });
    if (r.ok) ok++;
    else if (r.status === 409 || r.status === 400) { skipped++; console.warn(`  ja existeix o rebutjat: ${bucket}/${path}`); }
    else throw new Error(`upload ${bucket}/${path}: ${r.status} ${await r.text()}`);
  }
}
console.log(`✔ ${ok} fitxers restaurats, ${skipped} omesos`);
