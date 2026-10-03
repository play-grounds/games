// The map. Single source of truth for coordinates — see CONTRACT.md.
// 1 unit = 1 m, Y up, north = −Z, east = +X. Yaw 0 looks north; forward = (−sin yaw, 0, −cos yaw).

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Playable area; the world closes it off with rubble, barricades and buildings.
export const BOUNDS = { x0: -350, x1: 292, z0: -100, z1: 92 };

// The Vltava: water between x0 and x1, the full length of the map.
export const RIVER = { x0: -45, x1: 45, water: -3.5, bed: -6 };

export const BRIDGE = { x0: -52, x1: 52, z: 0, width: 10 };           // Charles Bridge deck at y=0
export const HILL = { start: -150, top: -265, height: 28 };          // Hradčany rises to the west

export const OTS = { x: 150, z: 0, w: 64, d: 56 };                    // Old Town Square (open)
export const MS_SQUARE = { x: -125, z: 0, w: 40, d: 46 };             // Malá Strana square
export const CASTLE = { x0: -345, x1: -265, z0: -70, z1: 30 };        // walled plateau
export const CASTLE_GATE = { x: -265, z: -20, width: 8 };
export const COURTYARD = { x: -305, z: -20, w: 60, d: 70 };            // camp inside the walls

// Old Town Hall tower with the astronomical clock; dial on its south face looking down Karlova.
export const TOWN_HALL = { x0: 96, x1: 118, z0: -34, z1: -6 };
export const CLOCK_TOWER = { x: 113, z: -11, w: 10, d: 10, h: 66 };
export const CLOCK = { x: 113, y: 12, z: -6, nx: 0, nz: 1 };
export const TYN = { x: 155, z: -48 };                                // twin spires behind the north row
export const ST_NICHOLAS = { x: -125, z: -40 };                       // green dome above Malá Strana
export const POWDER_TOWER = { x: 272, z: 15 };                        // gate at the east end of Celetná

// The pharmacy: south side of Celetná. Door normal points into the street (north).
export const PHARMACY_DOOR = { x: 220, z: 13, nx: 0, nz: -1 };
export const INTERIOR = { x: 2000, z: 2000 };                         // pharmacy cell origin

export const MEDIC = { x: -312, z: -12 };
export const START = { x: 256, z: 11, yaw: Math.PI / 2 };             // facing west down Celetná
export const BRIDGE_HORDE = { x: -8, z: 0 };

// Street centrelines (polylines) and widths. Kept clear of colliders. The route is
// START → celetna → OTS → karlova → bridge → mostecka → MS_SQUARE → nerudova → gate → courtyard.
export const STREETS = [
  { name: 'celetna', width: 9, pts: [[290, 16], [262, 12], [230, 10], [190, 4], [176, 0]] },
  { name: 'karlova', width: 7, pts: [[120, 2], [104, 11], [85, 6], [68, -4], [52, 0]] },
  { name: 'bridge', width: 10, pts: [[52, 0], [-52, 0]] },
  { name: 'mostecka', width: 9, pts: [[-52, 0], [-106, 0]] },
  { name: 'nerudova', width: 8, pts: [[-144, -4], [-175, -10], [-205, -16], [-235, -20], [-270, -20]] },
  // side alleys — dead ends and loops for the maze feel
  { name: 'melantrichova', width: 5, pts: [[150, 28], [146, 60], [152, 88]] },
  { name: 'zelezna', width: 5, pts: [[170, 28], [178, 70]] },
  { name: 'liliova', width: 4.5, pts: [[85, 6], [82, 40], [70, 70]] },
  { name: 'husova', width: 5, pts: [[96, -8], [92, -50], [96, -90]] },
  { name: 'tynska', width: 4.5, pts: [[182, -22], [210, -40], [240, -50]] },
  { name: 'retezova', width: 4.5, pts: [[68, -4], [62, -40]] },
  { name: 'tomasska', width: 5, pts: [[-120, -23], [-150, -60]] },
  { name: 'karmelitska', width: 6, pts: [[-120, 23], [-125, 80]] },
  { name: 'kampa', width: 5, pts: [[-58, 0], [-60, 50], [-62, 88]] },
];

// Open plazas (axis-aligned rectangles) that must also stay clear.
export const PLAZAS = [
  { name: 'ots', x: OTS.x, z: OTS.z, w: OTS.w, d: OTS.d },
  { name: 'ms', x: MS_SQUARE.x, z: MS_SQUARE.z, w: MS_SQUARE.w, d: MS_SQUARE.d },
  { name: 'courtyard', x: COURTYARD.x, z: COURTYARD.z, w: COURTYARD.w, d: COURTYARD.d },
];

const ROUTE_NAMES = ['celetna', 'karlova', 'bridge', 'mostecka', 'nerudova'];
// Points along the delivery route, for tests and objective markers.
export const ROUTE = [
  [START.x, START.z], [PHARMACY_DOOR.x, 9], [OTS.x, OTS.z], [120, 2], [104, 11], [85, 6], [68, -4], [52, 0], [0, 0],
  [-52, 0], [MS_SQUARE.x, MS_SQUARE.z], [-175, -10], [-235, -20], [CASTLE_GATE.x, CASTLE_GATE.z], [MEDIC.x, MEDIC.z + 4],
];

export function heightAt(x, z) {
  if (x > 1000) return 0;                                         // interior cells
  if (x > RIVER.x0 && x < RIVER.x1) {
    return Math.abs(z - BRIDGE.z) < BRIDGE.width / 2 ? 0 : RIVER.bed;
  }
  return HILL.height * smooth(HILL.start, HILL.top, x);
}

export function inRiver(x, z) {
  return x > RIVER.x0 && x < RIVER.x1 && Math.abs(z - BRIDGE.z) >= BRIDGE.width / 2;
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const qx = ax + dx * t, qz = az + dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t, qx, qz };
}

// Distance from (x,z) to the nearest street centreline: { d, street, along: unit tangent [tx,tz] }.
export function nearestStreet(x, z) {
  let best = { d: Infinity, street: null, along: [1, 0] };
  for (const s of STREETS) {
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
      const r = segDist(x, z, ax, az, bx, bz);
      if (r.d < best.d) {
        const L = Math.hypot(bx - ax, bz - az);
        best = { d: r.d, street: s, along: [(bx - ax) / L, (bz - az) / L] };
      }
    }
  }
  return best;
}

export function inPlaza(x, z, margin = 0) {
  return PLAZAS.some((p) => Math.abs(x - p.x) < p.w / 2 + margin && Math.abs(z - p.z) < p.d / 2 + margin);
}

// True where nothing solid may be built: streets (with margin), plazas, the river, the bridge deck.
export function mustStayClear(x, z, margin = 0.5) {
  if (inPlaza(x, z, margin)) return true;
  const n = nearestStreet(x, z);
  return n.d < n.street.width / 2 + margin;
}

export function onRoute(x, z) {
  const n = nearestStreet(x, z);
  return ROUTE_NAMES.includes(n.street.name) && n.d < n.street.width / 2;
}
