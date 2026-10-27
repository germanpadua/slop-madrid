// tools/madrid/config.mjs — Phase definitions for the Madrid build (see MADRID.md).
// Every bbox is ETRS89 / UTM zone 30N (EPSG:25830), meters: [xMin, yMin, xMax, yMax].
// Select a phase with MADRID_PHASE=fase1|fase2 when running the fetch/build tools (default: fase2).

export const CRS = 'EPSG:25830';

// WGS84 corners, converted with the transverse-Mercator inverse of tools/madrid/bbox.py
// (values verified against pyproj, sub-metre agreement at city scale).
export const PHASES = {
  // Phase 1 (published): centro ~1.9 km² — Sol, Gran Vía, Callao, Cibeles, Puerta de Alcalá, Plaza Mayor.
  fase1: {
    label: 'Centro (Sol-Gran Vía-Cibeles-Alcalá)',
    utm: [439550, 4473930, 441483, 4474914],
    wgs84: { xMin: -3.712500, yMin: 40.413800, xMax: -3.689800, yMax: 40.422800 },
  },
  // Phase 2: the west half of the almendra central, 8.45 km² (4.4x phase 1), from the Manzanares
  // (Príncipe Pío / Puente de Segovia) east to Atocha. Covers, with real geometry, every landmark
  // named for this phase: Debod (439103), Plaza de España (439551), Palacio Real (439400),
  // Almudena (439382), Gran Vía (440154-440685), Príncipe Pío (438844), Reina Sofía (441042),
  // Atocha (441412). The smaller box originally drafted here (439316,4473866,441428,4474730)
  // was 1.82 km² — no growth over phase 1, and it cut Debod, the Manzanares, Atocha, Reina Sofía
  // and Príncipe Pío; see MADRID.md "Fase 2 — bbox".
  fase2: {
    label: 'Almendra central oeste (Manzanares-Atocha)',
    utm: [438450, 4472800, 441700, 4475400],
    wgs84: { xMin: -3.725351, yMin: 40.403537, xMax: -3.687292, yMax: 40.427193 },
  },
};

export function getPhase() {
  const name = process.env.MADRID_PHASE || 'fase2';
  const p = PHASES[name];
  if (!p) throw new Error(`Unknown MADRID_PHASE "${name}" (have: ${Object.keys(PHASES).join(', ')})`);
  return { name, ...p };
}
