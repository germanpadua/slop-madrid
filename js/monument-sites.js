// js/monument-sites.js — which GEO.landmarks entries belong to the monument layer instead of the generic extruder.
//
// The eight hitos of the brief are owned by js/monumentos.js (real municipal meshes) or are recorded as missing in
// tools/madrid/monumentos.json when no public Ayuntamiento 3D layer contains them. In both cases landmarks.js must
// not extrude their footprint: a 24 m box over a plaza or a temple is worse than no volume at all.
//
// Kept renderer-free so tests can exercise the actual decision without importing three.

/** landmark names owned by the monument layer, grouped by monument id. */
export const MONUMENT_SITES = {
  cibeles: ['Fuente de Cibeles', 'Plaza de la Cibeles'],
  neptuno: [], // no GEO.landmarks footprint: the fountain is only a point-style statue entry
  alcala: ['Puerta de Alcalá'],
  debod: ['Templo de Debod'],
  palacio: ['Palacio Real', 'Catedral de la Almudena', 'Plaza de la Armería'],
  plazaespana: ['Plaza de España'],
  atocha: ['Estación de Atocha'],
  banco: ['Banco de España']
};

// The original eight brief sites remain available to callers; the ten delivered modules also
// include Almudena (split from Palacio) and Metrópolis. Reserve aliases before any static batching.
export const MONUMENT_MESH_SITES = {
  ...MONUMENT_SITES,
  neptuno: ['Fuente de Neptuno'],
  almudena: ['Catedral de la Almudena'],
  metropolis: ['Edificio Metrópolis', 'Metrópolis']
};
export const MONUMENT_SITE_NAMES = new Set(Object.values(MONUMENT_MESH_SITES).flat());
export const OPEN_SPACE = /^(Plaza|Glorieta|Parque|Jardín|Jardines|Paseo|Campo|Cuesta)\b|^Puerta del Sol\b/i;

export function hasProceduralMonument(name) {
  return !MONUMENT_SITE_NAMES.has(name) && name === 'Palacio de Cibeles';
}

/**
 * Footprints landmarks.js should extrude. Open squares are never masses (the old fallback turned Plaza Mayor or
 * Plaza de España into 24 m slabs); the monument sites belong to js/monumentos.js.
 * @param {Record<string, {ring?: number[], h?: number, w?: number}>} sites GEO.landmarks
 * @returns {Array<{name: string, lm: object, H: number}>}
 */
export function landmarkExtrusions(sites) {
  const out = [];
  for (const [name, lm] of Object.entries(sites)) {
    if (MONUMENT_SITE_NAMES.has(name)) continue;
    if (!lm || !lm.ring || lm.ring.length < 6 || lm.w < 12) continue;
    // Open squares (any name starting with Plaza) and any untagged footprint this wide are ground, not masses:
    // never turn them into invented 24 m slabs. Buildings big enough for a ring carry their IDEAM height.
    if (OPEN_SPACE.test(name)) continue;
    if (!(lm.h > 0)) continue;
    // Keep the measured IDEAM height without a floor or a ceiling.
    const H = lm.h;
    out.push({ name, lm, H });
  }
  return out;
}
