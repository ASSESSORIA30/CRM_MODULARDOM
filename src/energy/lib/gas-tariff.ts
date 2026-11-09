/** Equivalències de gas utilitzades pels filtres; no modifica les dades d'origen. */
export function gasTariffNumber(value: unknown): number | null {
  const text = String(value ?? "").toUpperCase().replace(/\s/g, "").replace(",", ".");
  const match = /^(?:RL\.?|3\.)(\d{1,2})$/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 11 ? n : null;
}
export function gasTariffAliases(value: unknown): string[] {
  const n = gasTariffNumber(value);
  return n == null ? [] : [`RL.${n}`, `RL${n}`, `RL ${n}`, `3.${n}`];
}
