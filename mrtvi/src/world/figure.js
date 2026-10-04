// Robed stone/bronze figure for statues: lathe robe with a hem flare, shoulders, neck, a
// separate ellipsoid head, arms as tapered beams (folded, raised, holding a cross or a staff).
// Built into a Batches `B` in frame F (feet at local y = y0, facing local −v).
import { P } from './geom.js';

export function robedFigure(B, F, y0, h, o = {}) {
  const key = o.key || 'stone', col = o.col, s = h / 2.1, rr = o.r ?? 1, bulk = o.bulk ?? 1;   // bulk: heavier shoulders + arms
  const at = (u, y, v) => P(F, u * s, y0 + y * s, v * s);
  const opt = { col, sides: o.sides || 9, sz: 0.8, mw: 3 };
  if (o.kneel) {
    B.lathe(key, F, 0, 0, [[0.46, 0], [0.5 * rr, 0.25], [0.36, 0.55], [0.27, 0.8], [0.29, 0.98], [0.22, 1.08], [0.1, 1.13], [0, 1.14]].map(([r, y]) => [r * s * rr, y0 + y * s]), opt);
    B.ball(key, F, 0, y0 + 1.27 * s, -0.06 * s, 0.14 * s, { k: 1.15, col, sides: 7, rings: 4 });
    for (const sg of [-1, 1]) B.beam(key, at(sg * 0.26, 0.98, 0), at(sg * 0.08, 0.9, -0.3), 0.07 * s, 0.06 * s, { col });   // praying hands
    return;
  }
  const prof = [[0.5, 0], [0.48, 0.1], [0.4, 0.55], [0.3, 1.1], [0.31, 1.42], [0.34, 1.6], [0.28, 1.71], [0.12, 1.77], [0, 1.79]];
  B.lathe(key, F, 0, 0, prof.map(([r, y]) => [r * s * (y < 1.2 ? rr : bulk), y0 + y * s]), { ...opt, lean: o.lean || 0 });
  B.prism(key, F, 0, 0, 0.075 * s, y0 + 1.74 * s, y0 + 1.86 * s, { sides: 6, col });
  B.ball(key, F, 0, y0 + 1.98 * s, -0.01 * s, 0.15 * s, { k: 1.18, col, sides: 8, rings: 5 });
  if (o.cowl) B.lathe(key, F, 0, 0.03 * s, [[0.2, 1.8], [0.19, 2.02], [0.12, 2.15], [0, 2.18]].map(([r, y]) => [r * s, y0 + y * s]), { col, sides: 8, sz: 1.05 });
  const sh = 1.6, arm = (sg, mid, hand, r = 0.075 * bulk) => {
    B.beam(key, at(sg * 0.3 * bulk, sh, 0), at(...mid), r * s, r * 0.85 * s, { col });
    B.beam(key, at(...mid), at(...hand), r * 0.85 * s, r * 0.7 * s, { col });
  };
  const fold = (sg) => arm(sg, [sg * 0.36, 1.22, -0.1], [sg * 0.08, 1.32, -0.3]);
  const pose = o.pose || 'fold';
  if (pose === 'raise') {
    fold(-1);
    arm(1, [0.5, 1.92, -0.08], [0.55, 2.42, -0.18]);
    B.ball(key, F, 0.56 * s, y0 + 2.5 * s, -0.19 * s, 0.07 * s, { col, sides: 6, rings: 3 });
  } else if (pose === 'cross') {
    fold(-1); fold(1);
    B.beam(key, at(0, 0.95, -0.36), at(0, 2.45, -0.36), 0.05 * s, 0.05 * s, { col, sides: 4 });
    B.beam(key, at(-0.32, 2.05, -0.36), at(0.32, 2.05, -0.36), 0.045 * s, 0.045 * s, { col, sides: 4 });
  } else if (pose === 'staff') {
    fold(-1);
    arm(1, [0.38, 1.25, -0.08], [0.4, 1.15, -0.25]);
    B.beam(key, at(0.42, 0, -0.26), at(0.42, 2.55, -0.26), 0.04 * s, 0.035 * s, { col, sides: 4 });
  } else if (pose === 'book') {
    arm(-1, [-0.36, 1.2, -0.1], [-0.1, 1.28, -0.34]);
    arm(1, [0.36, 1.2, -0.1], [0.12, 1.24, -0.34]);
    B.box(key, F, -0.2 * s, 0.2 * s, y0 + 1.25 * s, y0 + 1.33 * s, -0.48 * s, -0.22 * s, { col });
  } else {
    fold(-1); fold(1);
  }
}
