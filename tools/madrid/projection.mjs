// tools/madrid/projection.mjs — WGS84 <-> ETRS89/UTM30N (EPSG:25830) and the simulation's world frame.
// True 1:1 scale, 1 unit = 1 m, x = east, z = south (north = -z), origin at Puerta del Sol, no rotation.
// Transverse-Mercator series (Snyder) on the WGS84 ellipsoid — sub-cm error at city scale. Shared by build.mjs
// and tiles.mjs so the manifest and the generated geodata use the exact same frame.

const A = 6378137.0, F = 1 / 298.257223563, E2 = 2 * F - F * F, EP2 = E2 / (1 - E2);
const K0 = 0.9996, LON0 = -3 * Math.PI / 180;
export const SOL = [-3.7037900, 40.4167750]; // Puerta del Sol

export function utmForward(lon, lat) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const sp = Math.sin(phi), cp = Math.cos(phi), tp = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sp * sp);
  const T = tp * tp, C = EP2 * cp * cp;
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
  const dl = lam - LON0;
  const a2 = dl * cp;
  const x = K0 * N * (a2 + (1 - T + C) * a2 ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 ** 5 / 120) + 500000;
  const y = K0 * (M + N * tp * (a2 * a2 / 2 + (5 - T + 9 * C + 4 * C * C) * a2 ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 ** 6 / 720));
  return [x, y];
}

export function utmInverse(e, n) {
  const M = n / K0, mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const C1 = EP2 * cp * cp, T1 = tp * tp;
  const N1 = A / Math.sqrt(1 - E2 * sp * sp);
  const R1 = A * (1 - E2) / Math.pow(1 - E2 * sp * sp, 1.5);
  const D = (e - 500000) / (N1 * K0);
  const lat = phi1 - (N1 * tp / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / cp + LON0;
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

export const [SOLX, SOLY] = utmForward(SOL[0], SOL[1]);
export const toWorld = (lon, lat) => { const [e, n] = utmForward(lon, lat); return [e - SOLX, SOLY - n]; };
export const utmToWorld = (x, y) => [x - SOLX, SOLY - y];
