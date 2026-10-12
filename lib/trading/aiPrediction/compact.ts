/**
 * Reduce cualquier JSON de la app a algo que quepa en un prompt: números con
 * 6 cifras significativas, listas largas recortadas a sus últimos elementos y
 * textos largos cortados. Genérico a propósito: el contexto viene de una
 * docena de fuentes con formas distintas y todas cambian con el tiempo.
 */

export type CompactOptions = { maxArray?: number; maxString?: number; maxDepth?: number };

export function compactJson(value: unknown, options: CompactOptions = {}, depth = 0): unknown {
  const { maxArray = 20, maxString = 300, maxDepth = 6 } = options;

  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(6)) : null;
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (typeof value === 'boolean') return value;
  if (depth >= maxDepth) return '…';

  if (Array.isArray(value)) {
    // Lo último suele ser lo relevante (barras, señales, niveles recientes).
    const kept = value.length > maxArray ? value.slice(value.length - maxArray) : value;
    return kept.map((item) => compactJson(item, options, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const compacted = compactJson(item, options, depth + 1);
      if (compacted !== null) out[key] = compacted;
    }
    return out;
  }

  return null;
}
