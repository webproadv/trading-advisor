import { DEFAULT_SETTINGS, type Settings } from "./types";

/** Accetta solo le chiavi note, con il tipo giusto. Tutto il resto viene ignorato. */
export function pickSettings(input: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  const src = (input ?? {}) as Record<string, unknown>;
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in src)) continue;
    const v = src[k];
    if (Array.isArray(def)) { if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v.map((x) => (x as string).trim()); }
    else if (typeof def === "number") { const n = typeof v === "string" ? Number(v) : v; if (typeof n === "number" && Number.isFinite(n)) out[k] = n; }
    else if (typeof def === "boolean") { if (typeof v === "boolean") out[k] = v; }
    else if (k === "mode") { if (v === "advisor" || v === "autopilot") out[k] = v; }
  }
  return out as Partial<Settings>;
}
