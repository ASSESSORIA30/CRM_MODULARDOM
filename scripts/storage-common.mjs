import { readFileSync, existsSync } from 'node:fs';

export const BUCKETS = ['contractes', 'pressupostos', 'factures', 'planols', 'fotografies', 'documents'];

export function loadEnv(file = process.env.ENV_FILE || '.env.local') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function assertModulardom() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!url || !key || !ref) {
    console.error('Falten NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_PROJECT_REF');
    process.exit(1);
  }
  if (new URL(url).hostname !== `${ref}.supabase.co`) {
    console.error(`✖ La URL ${url} no correspon al projecte ${ref}. Operació cancel·lada.`);
    process.exit(1);
  }
  return { url: url.replace(/\/$/, ''), key };
}

// Funciona amb claus noves (sb_secret_...) i amb la service_role antiga.
export function headers(key) {
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
}
