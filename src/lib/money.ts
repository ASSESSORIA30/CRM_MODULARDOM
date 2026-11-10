// Imports monetaris: sempre cèntims enters. Mai floats per a càlculs.

/**
 * Converteix un text introduït per l'usuari ("350.000", "350000,50", "1.234,5 €")
 * a cèntims enters. Retorna null si està buit i llança si el format no és vàlid.
 * Convenció espanyola: "." separa milers i "," decimals. Un únic "." seguit de
 * 1-2 dígits s'accepta com a decimal ("350000.5").
 */
export function parseEurosToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/[€\s ]/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length !== 2) throw new Error("Import no vàlid");
    intPart = parts[0];
    decPart = parts[1];
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(intPart)) throw new Error("Import no vàlid");
    intPart = intPart.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, decPart] = s.split(".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s) || /^\d+$/.test(s)) {
    intPart = s.replace(/\./g, "");
  } else {
    throw new Error("Import no vàlid");
  }
  if (!/^\d*$/.test(decPart) || decPart.length > 2) throw new Error("Import no vàlid");
  const cents = BigInt(intPart || "0") * 100n + BigInt((decPart + "00").slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Import massa gran");
  return Number(negative ? -cents : cents);
}

/** Formata cèntims com a euros (format espanyol/català): 49658000 → "496.580,00 €" */
export function formatCents(cents: number | bigint | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (cents == null) return "—";
  const big = BigInt(cents);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const euros = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = (abs % 100n).toString().padStart(2, "0");
  const body = opts.decimals === false ? euros : `${euros},${dec}`;
  return `${negative ? "-" : ""}${body} €`;
}

/** Valor per a un camp d'entrada: 49658000 → "496580,00" */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
