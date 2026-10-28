// js/madrid-roofs.js — Madrid tejado decisions, pure and node-testable (no three imports), shared by the
// procedural seed city (js/buildings.js) and the phase-3 tile renderer (js/madrid-tile-world.js) so both
// paths apply IDENTICAL rules. Grounded in the user's Tiny-Madrid illustrated references.
//
// Rules (visual review 2026-10-28):
// - Parcels under 9m tall or 6m in either span keep flat roofing (low/small volumes).
// - ~28% of the rest stay flat (hash roll > 0.72): mix, not blanket conversion - Tiny's pervasive hips
//   are stylization.
// - Single-span parcels (min span <= 24m, or tall towers of any span) get an instanced terracotta hip
//   (tejado a cuatro aguas, ridge along the long axis).
// - Patio blocks (min span > 24m AND h <= 22m) get a perimeter ring with a patio opening. An
//   AABB-spanning hip there read as an industrial shed (rejected).
// - Collision containment: a ring falls back to flat when another known parcel pokes through its
//   inner-slope band, and a hip is suppressed when its base emerges <3m above a containing parcel's
//   flat slab (reads as a detached pyramid). Known = the caller's parcel list; the tile path passes
//   same-tile parcels only (bounded approximation, as medianeras), the procedural path passes none.
// - The ring's opening is a geometric opening in the roof mass; per-parcel evidence of a real courtyard
//   does not exist in the AABB model, so callers must not claim one.
const hash = (x, z, salt = 0) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

// P: { x0, x1, z0, z1, w, d, h } (AABB + height in metres). others: known neighbour AABBs for the clash
// test (may be empty). Returns null (flat) or { kind: 'hip' | 'ring', h, rot, ci, slate }.
// opts.minSpan: caller policy for the smallest roofable span (default 6m). The tile path relaxes it to
// 4m for footprint-decomposition strips, whose real depth is ~4.5-5m: perimeter blocks still get tejados.
export function roofDecision(P, others = [], opts = {}) {
  const minSpan = opts.minSpan ?? 6;
  if (P.h < 9 || P.w < minSpan || P.d < minSpan) return null;
  const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  const tall = P.h > 22; // towers always hip (documented rule); the 28% flat mix applies below them
  if (!tall && hash(cx, cz, 11) > 0.72) return null;
  // Floating-hip containment: when another known parcel's AABB contains this parcel's centre and its flat
  // slab top sits less than 3m below this parcel's roof base, the hip would read as a detached pyramid
  // sitting on the neighbour's slab (too little wall showing). Suppress it.
  const cover = others.reduce((m, Q) => (Q !== P && Q.h < P.h && cx >= Q.x0 && cx <= Q.x1 && cz >= Q.z0 && cz <= Q.z1) ? Math.max(m, Q.h) : m, 0);
  if (cover > 0 && P.h - cover < 3) return null;
  const base = {
    h: Math.min(4.2, Math.max(2.0, Math.min(P.w, P.d) * (0.26 + hash(cx, cz, 12) * 0.08))),
    rot: P.d > P.w ? Math.PI / 2 : 0,
    ci: Math.floor(hash(cx, cz, 13) * 5),
    slate: hash(cx, cz, 14) < 0.08
  };
  if (Math.min(P.w, P.d) > 24 && P.h <= 22) {
    const bX0 = P.x0 + P.w * 0.16, bX1 = P.x1 - P.w * 0.16;
    const bZ0 = P.z0 + P.d * 0.16, bZ1 = P.z1 - P.d * 0.16;
    const oX0 = P.x0 + P.w * 0.30, oX1 = P.x1 - P.w * 0.30;
    const oZ0 = P.z0 + P.d * 0.30, oZ1 = P.z1 - P.d * 0.30;
    const clash = others.some((Q) => Q !== P && Q.h > P.h * 0.45 &&
      Q.x1 > bX0 && Q.x0 < bX1 && Q.z1 > bZ0 && Q.z0 < bZ1 &&
      !(Q.x0 >= oX0 && Q.x1 <= oX1 && Q.z0 >= oZ0 && Q.z1 <= oZ1));
    if (clash) return null;
    return { kind: 'ring', ...base };
  }
  return { kind: 'hip', ...base };
}
