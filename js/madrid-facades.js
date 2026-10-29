// Shared Madrid skin data; no renderer imports, so streaming policy and Node tests stay independent.
// Both boxes and contours use the same material and wall-coordinate shader (see facadeCell).
export const MADRID_FACADE_OPTS = Object.freeze([
  Object.freeze({ // 0: caliza blanca (Gran Via / Palacio Real limestone)
    madrid: true,
    boxLocal: true,
    parcelWalls: true,
    stoneColor: 0xe7ddc6,
    trimColor: 0xcfc2a6,
    windowGlassColor: 0x202e3a,
    windowWidth: 1.5,
    floorHeight: 3.4,
    litProbability: 0.5,
    warmth: 0.85,
    seed: 21.7
  }),
  Object.freeze({ // 1: ladrillo visto rojizo (residencial / neomudejar)
    madrid: true,
    boxLocal: true,
    parcelWalls: true,
    stoneColor: 0xa45538,
    trimColor: 0xd8c39a,
    windowGlassColor: 0x1c2833,
    windowWidth: 1.5,
    floorHeight: 3.3,
    litProbability: 0.48,
    warmth: 0.9,
    seed: 33.2
  }),
  Object.freeze({ // 2: revoco ocre claro (La Latina / Lavapies - el ocre luminoso de Tiny-Madrid)
    madrid: true,
    boxLocal: true,
    parcelWalls: true,
    stoneColor: 0xe0ba7f,
    trimColor: 0xf0e2c2,
    windowGlassColor: 0x243441,
    windowWidth: 1.4,
    floorHeight: 3.1,
    litProbability: 0.45,
    warmth: 0.95,
    seed: 47.9
  }),
  Object.freeze({ // 3: revoco salmon rosado (acentos del casco antiguo en Tiny-Madrid)
    madrid: true,
    boxLocal: true,
    parcelWalls: true,
    stoneColor: 0xdc9d7e,
    trimColor: 0xecd3b8,
    windowGlassColor: 0x223038,
    windowWidth: 1.4,
    floorHeight: 3.2,
    litProbability: 0.45,
    warmth: 0.95,
    seed: 58.3
  })
]);


// Stable world-position mix: caliza/ladrillo dominate, revoco supplies the accents.
// No parcel-array index: reordering or streaming a tile cannot recolour its buildings.
export const MADRID_FACADE_WEIGHTS = Object.freeze([0.40, 0.35, 0.15, 0.10]);
export function madridFacadeTier(x, z) {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  const roll = v - Math.floor(v);
  let threshold = 0;
  for (let i = 0; i < MADRID_FACADE_WEIGHTS.length; i++) {
    threshold += MADRID_FACADE_WEIGHTS[i];
    if (roll < threshold) return i;
  }
  return MADRID_FACADE_WEIGHTS.length - 1;
}

/**
 * Named-monument facade styles for the tile world: each identified landmark gets the material of its real
 * reference (caliza blanca de Colmenar, granito berroqueno, the red fronts of the Plaza Mayor), not one blanket
 * tone. First regex that matches the OSM name wins; unmatched landmarks keep the neutral stone default.
 */
export const MADRID_LANDMARK_STYLES = Object.freeze([
  Object.freeze([/\bpalacio real\b/i, Object.freeze({ color: 0xece5d3, roughness: 0.7 })]),
  Object.freeze([/\balmudena\b/i, Object.freeze({ color: 0xe8e1cf, roughness: 0.72 })]),
  Object.freeze([/\bplaza de toros\b/i, Object.freeze({ color: 0x9a4b38, roughness: 0.8 })]),
  Object.freeze([/\bpuerta de alcal/i, Object.freeze({ color: 0xe5dfce, roughness: 0.65 })]),
  Object.freeze([/\bcibeles\b/i, Object.freeze({ color: 0xeae3d1, roughness: 0.7 })]),
  Object.freeze([/\bmetr[oó]polis\b/i, Object.freeze({ color: 0xdfd7c2, roughness: 0.68 })]),
  Object.freeze([/\bteatro real\b/i, Object.freeze({ color: 0xe6dfd0, roughness: 0.7 })]),
  Object.freeze([/\bplaza mayor\b/i, Object.freeze({ color: 0xb0624a, roughness: 0.8 })]),
  Object.freeze([/\bcasa de la panader[ií]a\b/i, Object.freeze({ color: 0xa8574a, roughness: 0.78 })]),
  Object.freeze([/\btemplo de debod\b/i, Object.freeze({ color: 0xc9b18a, roughness: 0.8 })]),
  Object.freeze([/\bbanco de espa[nñ]a\b/i, Object.freeze({ color: 0xe6dfcd, roughness: 0.7 })]),
  Object.freeze([/\b(catedral|iglesia|basilica|basílica|ermita)\b/i, Object.freeze({ color: 0xe3dcc8, roughness: 0.74 })])
]);
