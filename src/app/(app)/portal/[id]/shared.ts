import "server-only";
import type { CurrentProfile } from "@/lib/auth";
import type { DocRow } from "@/lib/avantprojecte-data";

export type SectionProps = {
  projectId: string;
  profile: CurrentProfile;
  status: { base: number; granted: number; used: number; available: number };
};

/** Documents sobre els quals es pot treballar al visor (PDF o imatge visibles al client) */
export function viewableDocs(groups: DocRow[][], current: (g: DocRow[]) => DocRow) {
  return groups.map(current).filter((d) => /\.(pdf|png|jpe?g|webp)$/i.test(d.storage_path));
}

/** Versió vigent de l'avantprojecte publicat */
export function currentAvantprojecte(groups: DocRow[][]) {
  for (const g of groups) {
    const v = g.find((d) => d.category === "avantprojecte" && d.visibility === "publicat" && d.status === "vigent");
    if (v) return { doc: v, group: g };
  }
  return null;
}
