/** Les relacions incrustades de PostgREST poden arribar com a objecte o com a array segons la cardinalitat detectada. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
