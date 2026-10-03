// Ground, masonry, roofs and materials. All tileable.
import { rng } from '../layout.js';
import {
  canvas, noiseTile, noiseMask, blendTile, grain, desaturate, rgbStr, shade, mix,
  blobPath, stain, crack, streaks, wrapDraw, splatter,
} from './paint.js';

function granite(R, dirt = 0) {
  // Narrow value range: setts read as individual stones but not as a checkerboard.
  const t = R();
  const base = t < 0.6 ? [78, 77, 75] : t < 0.8 ? [84, 78, 73] : t < 0.93 ? [72, 75, 79] : [90, 87, 82];
  const k = 0.88 + R() * 0.2 - dirt;
  return rgbStr(base[0] * k, base[1] * k, base[2] * k);
}

// Small stone with soft top light and a darker lower lip; joints stay dark.
function cube(g, x, y, w, h, a, col, R) {
  g.save();
  g.translate(x, y); g.rotate(a);
  g.fillStyle = col;
  g.beginPath();
  const jx = w * 0.14, jy = h * 0.14;
  g.moveTo(-w / 2 + R() * jx, -h / 2 + R() * jy);
  g.lineTo(w / 2 - R() * jx, -h / 2 + R() * jy);
  g.lineTo(w / 2 - R() * jx, h / 2 - R() * jy);
  g.lineTo(-w / 2 + R() * jx, h / 2 - R() * jy);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(-w / 2 + jx, -h / 2 + jy, w - jx * 2.5, h * 0.3);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(-w / 2 + jx, h / 2 - jy - h * 0.2, w - jx * 2, h * 0.2);
  g.restore();
}

// Low-frequency variation for big ground textures: broad dirt/wet zones, puddles, grime in joints.
// Uses noise tiles scaled so one period spans the canvas (stays tileable).
function wetStone(g, S, seed) {
  const R = rng(seed);
  const k = S / 256;
  blendTile(g, noiseTile(seed, 256, 2, 4), 'overlay', 0.35, k);                       // broad light/dark drift
  blendTile(g, noiseTile(seed + 1, 256, 8, 4), 'overlay', 0.18, k / 2);               // mid
  blendTile(g, noiseMask(seed + 2, [28, 25, 21], 0.4, 0.8, 256, 3), 'source-over', 0.45, k); // dirt fields
  blendTile(g, noiseMask(seed + 3, [36, 40, 30], 0.6, 0.85, 256, 6), 'source-over', 0.3, k);  // moss/silt
  // Wet darkening (large soft multiply patches) + puddles with a faint cool sheen.
  blendTile(g, noiseMask(seed + 4, [70, 72, 78], 0.45, 0.75, 256, 2), 'multiply', 0.38, k);
  for (let i = 0; i < 5; i++) {
    const x = R() * S, y = R() * S, rx = S * (0.04 + R() * 0.08), ry = rx * (0.5 + R() * 0.4), sd = R() * 1e6;
    wrapDraw(S, S, x, y, rx * 1.5, (X, Y) => {
      const PR = rng(sd);
      g.save();
      blobPath(g, X, Y, rx, ry, PR, 22, 0.5);
      g.fillStyle = 'rgba(14,15,17,0.55)'; g.fill();
      g.clip();
      const gr = g.createLinearGradient(X - rx, Y - ry, X + rx, Y + ry);
      gr.addColorStop(0, 'rgba(120,130,140,0.10)'); gr.addColorStop(0.5, 'rgba(120,130,140,0.02)'); gr.addColorStop(1, 'rgba(120,130,140,0.08)');
      g.fillStyle = gr; g.fillRect(X - rx, Y - ry, rx * 2, ry * 2);
      g.restore();
      stain(g, X, Y, rx * 1.6, 'rgba(20,20,22,1)', 0.35);
    });
  }
  for (let i = 0; i < 14; i++) {
    const x = R() * S, y = R() * S, r = S * (0.02 + R() * 0.06);
    wrapDraw(S, S, x, y, r, (X, Y) => stain(g, X, Y, r, 'rgba(22,19,15,1)', 0.3));
  }
  desaturate(g, 0.3);
  grain(g, 0.1);
}

// Street setts laid in segmental arcs (Prague "obloukové dláždění"). [6,6] m.
export function cobble() {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#141311'; g.fillRect(0, 0, S, S);
  const ppm = S / 6, s = 0.115 * ppm;                // sett ≈ 11.5 cm
  const P = S / 4, rows = 8, cols = 4;               // fan = 1.5 m wide, rows 0.75 m
  const r0 = P * 0.73;
  for (let j = -2; j <= rows + 2; j++) {
    for (let i = -1; i <= cols + 1; i++) {
      const cx = i * P + ((j & 1) ? P / 2 : 0), cy = j * (P / 2);
      const fi = ((i % cols) + cols) % cols, fj = ((j % rows) + rows) % rows;
      const R = rng(fi * 31 + fj * 7 + 101);
      const jit = (R() - 0.5) * 0.12;                // each fan slightly different
      for (let r = r0 * (1 + jit * 0.3); r > s; r -= s * (1.03 + R() * 0.06)) {
        const n = Math.max(2, Math.floor((Math.PI * r) / (s * 1.05)));
        for (let k = 0; k < n; k++) {
          const a = Math.PI + ((k + 0.5) / n) * Math.PI;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          const col = granite(R), w = s * (0.82 + R() * 0.14), h = s * (0.78 + R() * 0.12), da = (R() - 0.5) * 0.15;
          if (x < -s || x > S + s || y < -s || y > S + s) { for (let q = 0; q < 8; q++) R(); continue; }
          cube(g, x, y, w, h, a + Math.PI / 2 + da, col, R);
        }
      }
    }
  }
  wetStone(g, S, 61);
  return c;
}

// Old Town Square paving: small granite cubes with a faint diamond pattern in slightly darker stone. [8,8] m.
export function paving() {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#151412'; g.fillRect(0, 0, S, S);
  const n = 80, s = S / n, R = rng(202), D = 20;     // 10 cm cubes, 2 m diamonds
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.abs((x % D) - (D - 1) / 2), dy = Math.abs((y % D) - (D - 1) / 2);
    const band = dx + dy > D * 0.42 && dx + dy < D * 0.52;
    const k = 0.86 + R() * 0.22;
    const col = band ? [62 * k, 63 * k, 66 * k] : [92 * k, 89 * k, 83 * k];
    cube(g, (x + 0.5) * s + (R() - 0.5) * 2, (y + 0.5) * s + (R() - 0.5) * 2, s * 0.84, s * 0.84, (R() - 0.5) * 0.3, rgbStr(...col), R);
  }
  // Missing cubes and a relaid patch.
  for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(18,16,13,0.9)'; const x = (R() * n | 0) * s, y = (R() * n | 0) * s; g.fillRect(x, y, s * (1 + (R() * 2 | 0)), s); }
  wetStone(g, S, 63);
  return c;
}

export function asphalt() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(303);
  g.fillStyle = '#3d3c3a'; g.fillRect(0, 0, S, S);
  blendTile(g, noiseTile(71, 256, 4), 'overlay', 0.45, 2);
  grain(g, 0.45);
  grain(g, 0.2, 'multiply');
  // Patches.
  for (let i = 0; i < 3; i++) {
    const x = R() * S, y = R() * S, w = 60 + R() * 120, h = 40 + R() * 80;
    wrapDraw(S, S, x, y, Math.max(w, h), (X, Y) => { g.fillStyle = 'rgba(30,30,30,0.5)'; g.fillRect(X, Y, w, h); g.strokeStyle = 'rgba(15,15,15,0.6)'; g.lineWidth = 2; g.strokeRect(X, Y, w, h); });
  }
  for (let i = 0; i < 9; i++) crack(g, R() * S, R() * S, 60 + R() * 160, R, 'rgba(12,12,12,0.85)', 1.6, R() * 6.3);
  for (let i = 0; i < 6; i++) { const x = R() * S, y = R() * S, r = 15 + R() * 35; wrapDraw(S, S, x, y, r, (X, Y) => stain(g, X, Y, r, 'rgba(10,10,12,1)', 0.5)); }
  blendTile(g, noiseMask(73, [50, 44, 34], 0.55, 0.85, 256, 4), 'source-over', 0.5, 2);
  desaturate(g, 0.3);
  return c;
}

// Sandstone ashlar, blackened (Charles Bridge / towers).
export function stone() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(404);
  g.fillStyle = '#1e1c19'; g.fillRect(0, 0, S, S);
  const rowH = S / 8;                                  // [3,3] m → 37.5 cm courses
  for (let r = 0; r < 8; r++) {
    let x = (r % 2) * 40 - 80;
    while (x < S) {
      const w = 70 + R() * 70;
      const ww = Math.min(w, S - x + 80);
      const k = 0.6 + R() * 0.5;
      const col = mix([120, 104, 80], [58, 54, 50], R() * 0.8);
      wrapDraw(S, S, x + ww / 2, r * rowH + rowH / 2, ww, (X, Y) => {
        g.fillStyle = rgbStr(col[0] * k, col[1] * k, col[2] * k);
        g.fillRect(X - ww / 2 + 2, Y - rowH / 2 + 2, ww - 4, rowH - 4);
        g.fillStyle = 'rgba(255,240,210,0.07)'; g.fillRect(X - ww / 2 + 2, Y - rowH / 2 + 2, ww - 4, 3);
      });
      x += w;
    }
  }
  blendTile(g, noiseTile(81, 256, 8), 'overlay', 0.6, 1);
  // Black crust, heavier in streaks.
  blendTile(g, noiseMask(83, [18, 16, 15], 0.45, 0.8, 256, 6), 'source-over', 0.6, 2);
  for (let x = 0; x < S; x += 4) if (R() < 0.6) streaks(g, x, R() * S, 8, 80 + R() * 260, R, 2, 0.55, '10,10,10');
  for (let i = 0; i < 6; i++) crack(g, R() * S, R() * S, 50 + R() * 80, R, 'rgba(8,8,8,0.8)', 1.2);
  grain(g, 0.2);
  desaturate(g, 0.25);
  return c;
}

// Red clay beaver-tail tiles with moss. Top of texture = ridge.
export function roof() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(505);
  g.fillStyle = '#2a140e'; g.fillRect(0, 0, S, S);
  const tw = S / 12, th = S / 16;                      // [2,2] m → 17 cm wide, 12.5 cm courses
  const tl = [];
  for (let row = 0; row < 16; row++) for (let i = 0; i < 12; i++) tl.push([i * tw + (row & 1) * tw / 2 + tw / 2, row * th, 0.6 + R() * 0.45, R() < 0.1 ? [95, 50, 35] : [140, 62, 42]]);
  // Pass 1: the course underneath (visible between the rounded ends). Pass 2: the rounded tails, one course tall.
  for (const [x, y, k, b] of tl) wrapDraw(S, S, x, y, tw, (X, Y) => { g.fillStyle = rgbStr(b[0] * k * 0.45, b[1] * k * 0.45, b[2] * k * 0.45); g.fillRect(X - tw / 2 + 1, Y - th, tw - 2, th); });
  for (const [x, y, k, b] of tl) wrapDraw(S, S, x, y, tw, (X, Y) => {
    const gr = g.createLinearGradient(0, Y, 0, Y + th);
    gr.addColorStop(0, rgbStr(b[0] * k * 0.65, b[1] * k * 0.65, b[2] * k * 0.65));
    gr.addColorStop(1, rgbStr(b[0] * k, b[1] * k, b[2] * k));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(X - tw / 2 + 1, Y); g.lineTo(X - tw / 2 + 1, Y + th * 0.35);
    g.ellipse(X, Y + th * 0.35, tw / 2 - 1, th * 0.62, 0, Math.PI, 0, true);
    g.lineTo(X + tw / 2 - 1, Y); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(20,8,5,0.6)'; g.lineWidth = 1.5; g.stroke();
  });
  blendTile(g, noiseTile(91, 256, 4), 'overlay', 0.5, 2);
  blendTile(g, noiseMask(93, [62, 70, 38], 0.6, 0.8, 256, 6), 'source-over', 0.55, 2);
  blendTile(g, noiseMask(94, [80, 90, 45], 0.68, 0.8, 256, 16), 'source-over', 0.6, 1);
  blendTile(g, noiseMask(95, [30, 28, 24], 0.5, 0.8, 256, 4), 'source-over', 0.5, 2);
  for (let i = 0; i < 8; i++) { const x = R() * S, y = R() * S, r = 6 + R() * 12; g.fillStyle = 'rgba(100,110,60,0.6)'; blobPath(g, x, y, r, r * 0.6, R); g.fill(); }
  grain(g, 0.15);
  desaturate(g, 0.35);
  return c;
}

export function slate() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(606);
  g.fillStyle = '#16181a'; g.fillRect(0, 0, S, S);
  const tw = S / 10, th = S / 16;
  const tl = [];
  for (let row = 0; row < 16; row++) for (let i = 0; i < 10; i++) tl.push([i * tw + (row & 1) * tw / 2 + tw / 2, row * th, 0.7 + R() * 0.4]);
  for (const [x, y, k] of tl) wrapDraw(S, S, x, y, tw, (X, Y) => { g.fillStyle = rgbStr(40 * k, 44 * k, 50 * k); g.fillRect(X - tw / 2 + 1, Y - th, tw - 2, th); });
  for (const [x, y, k] of tl) wrapDraw(S, S, x, y, tw, (X, Y) => {
    g.fillStyle = rgbStr(62 * k, 68 * k, 76 * k);
    g.beginPath();
    g.moveTo(X - tw / 2 + 1, Y); g.lineTo(X - tw / 2 + 1, Y + th * 0.4);
    g.lineTo(X, Y + th); g.lineTo(X + tw / 2 - 1, Y + th * 0.4); g.lineTo(X + tw / 2 - 1, Y);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5; g.stroke();
  });
  blendTile(g, noiseTile(97, 256, 8), 'overlay', 0.45, 1);
  blendTile(g, noiseMask(98, [70, 75, 50], 0.62, 0.82, 256, 6), 'source-over', 0.6, 2);
  grain(g, 0.15);
  return c;
}

export function plank() {
  const W = 256, Hh = 512, c = canvas(W, Hh), g = c.getContext('2d'), R = rng(707);
  const n = 5, pw = W / n;
  for (let i = 0; i < n; i++) {
    const k = 0.6 + R() * 0.4;
    g.fillStyle = rgbStr(102 * k, 84 * k, 62 * k); g.fillRect(i * pw, 0, pw, Hh);
    for (let l = 0; l < 26; l++) {
      g.strokeStyle = `rgba(${30 + R() * 30},${22 + R() * 20},${14},${0.25 + R() * 0.3})`;
      g.lineWidth = 0.6 + R();
      const x = i * pw + R() * pw;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= Hh; y += 32) g.lineTo(x + Math.sin(y * 0.02 + l) * 2 + (R() - 0.5), y);
      g.stroke();
    }
    if (R() < 0.6) { const y = R() * Hh; g.fillStyle = 'rgba(30,20,12,0.8)'; g.beginPath(); g.ellipse(i * pw + pw / 2, y, 5, 8, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(8,6,4,0.9)'; g.fillRect(i * pw, 0, 2, Hh);
    // Nails.
    for (const y of [Hh * 0.1, Hh * 0.6]) { g.fillStyle = '#2a2420'; g.fillRect(i * pw + pw * 0.3, y, 3, 3); g.fillRect(i * pw + pw * 0.7, y, 3, 3); streaks(g, i * pw + pw * 0.5, y + 3, pw * 0.5, 40, R, 3, 0.4, '60,30,15'); }
  }
  blendTile(g, noiseTile(101, 256, 4), 'overlay', 0.4, 2);
  blendTile(g, noiseMask(103, [40, 40, 36], 0.5, 0.8, 256, 4), 'source-over', 0.45, 2);
  desaturate(g, 0.45);
  grain(g, 0.12);
  return c;
}

export function rust() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(808);
  g.fillStyle = '#6e4a32'; g.fillRect(0, 0, S, S);
  blendTile(g, noiseTile(111, 256, 4), 'overlay', 0.7, 1);
  blendTile(g, noiseMask(112, [120, 58, 22], 0.4, 0.7, 256, 8), 'source-over', 0.6, 1);
  blendTile(g, noiseMask(113, [70, 72, 70], 0.6, 0.8, 256, 4), 'source-over', 0.5, 1);
  // Corrugation.
  for (let x = 0; x < S; x += 16) {
    const gr = g.createLinearGradient(x, 0, x + 16, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(255,220,180,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr; g.fillRect(x, 0, 16, S);
  }
  for (let x = 0; x < S; x += 5) if (R() < 0.5) streaks(g, x, R() * S, 5, 60 + R() * 120, R, 1, 0.35, '50,20,8');
  grain(g, 0.25);
  return c;
}

// Castle render: clean Baroque lime render, pale ochre-grey, subtle trowel mottling and dirt. [4,4] m,
// tiles in both directions (no top/bottom gradient) for large world-space surfaces.
export function wall() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(909);
  g.fillStyle = '#b6a886'; g.fillRect(0, 0, S, S);
  blendTile(g, noiseTile(121, 256, 2, 4), 'overlay', 0.22, 2);        // broad tone drift
  blendTile(g, noiseTile(122, 256, 8, 5), 'soft-light', 0.28, 1);     // trowel mottling
  blendTile(g, noiseTile(124, 256, 32, 2), 'soft-light', 0.2, 1);     // fine render texture
  blendTile(g, noiseMask(125, [150, 148, 138], 0.55, 0.8, 256, 3), 'source-over', 0.35, 2); // greyer limewash zones
  // Faint dirt runs, wide and soft.
  for (let i = 0; i < 26; i++) {
    const x = R() * S, y = R() * S, len = 80 + R() * 220;
    wrapDraw(S, S, x, y + len / 2, len, (X, Y) => streaks(g, X, Y - len / 2, 18, len, R, 3, 0.12, '60,52,40'));
  }
  blendTile(g, noiseMask(123, [92, 88, 74], 0.6, 0.85, 256, 4), 'source-over', 0.3, 2);
  // A couple of small patched repairs and hairline cracks.
  for (let i = 0; i < 2; i++) {
    const x = R() * S, y = R() * S, rx = 14 + R() * 20, ry = 10 + R() * 14;
    wrapDraw(S, S, x, y, rx * 1.4, (X, Y) => { g.fillStyle = 'rgba(165,158,140,0.55)'; blobPath(g, X, Y, rx, ry, rng(i + 7), 12, 0.4); g.fill(); });
  }
  for (let i = 0; i < 3; i++) crack(g, 40 + R() * (S - 80), 40 + R() * (S - 80), 30 + R() * 50, R, 'rgba(60,52,44,0.45)', 0.8);
  desaturate(g, 0.25);
  grain(g, 0.08);
  return c;
}

// Pale weathered sandstone ashlar (Old Town Hall tower, gates). [3,3] m, 37.5 cm courses.
export function stoneLight() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(4040);
  g.fillStyle = '#6e6454'; g.fillRect(0, 0, S, S);
  const rowH = S / 8;
  for (let r = 0; r < 8; r++) {
    let x = R() * 60;
    const end = x + S;
    while (x < end) {
      const w = Math.min(70 + R() * 90, end - x);
      if (w < 30) break;
      const k = 0.88 + R() * 0.18;
      const col = mix([186, 170, 136], [160, 152, 136], R());
      const cx = x + w / 2, cy = r * rowH + rowH / 2;
      wrapDraw(S, S, cx, cy, w, (X, Y) => {
        g.fillStyle = rgbStr(col[0] * k, col[1] * k, col[2] * k);
        g.fillRect(X - w / 2 + 1.5, Y - rowH / 2 + 1.5, w - 3, rowH - 3);
        g.fillStyle = 'rgba(255,248,225,0.10)'; g.fillRect(X - w / 2 + 1.5, Y - rowH / 2 + 1.5, w - 3, 2);
        g.fillStyle = 'rgba(40,32,24,0.18)'; g.fillRect(X - w / 2 + 1.5, Y + rowH / 2 - 4, w - 3, 2.5);
      });
      x += w;
    }
  }
  blendTile(g, noiseTile(4041, 256, 16, 4), 'soft-light', 0.45, 1);    // grainy sandstone
  blendTile(g, noiseTile(4042, 256, 3), 'overlay', 0.25, 2);
  // Weathering: eroded pits, grey crust in patches, soft soot runs.
  for (let i = 0; i < 40; i++) { const x = R() * S, y = R() * S, rr = 2 + R() * 6; wrapDraw(S, S, x, y, rr, (X, Y) => stain(g, X, Y, rr, 'rgba(70,60,48,1)', 0.45)); }
  blendTile(g, noiseMask(4043, [70, 68, 62], 0.55, 0.85, 256, 5), 'source-over', 0.35, 2);
  for (let x = 0; x < S; x += 6) if (R() < 0.35) { const y = R() * S, l = 60 + R() * 160; wrapDraw(S, S, x, y + l / 2, l, (X, Y) => streaks(g, X, Y - l / 2, 6, l, R, 2, 0.22, '35,32,28')); }
  for (let i = 0; i < 4; i++) crack(g, R() * S, R() * S, 30 + R() * 60, R, 'rgba(50,42,34,0.6)', 1);
  desaturate(g, 0.3);
  grain(g, 0.12);
  return c;
}

// Pharmacy interior: white tiles below 1.5 m, pale green paint above. [3,3] m.
export function interiorWall() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(1010);
  const ppm = S / 3, ty = S - 1.5 * ppm;
  g.fillStyle = '#9fae9c'; g.fillRect(0, 0, S, ty);
  blendTile(g, noiseTile(131, 256, 4), 'overlay', 0.4, 2);
  g.fillStyle = '#7d756a'; g.fillRect(0, ty, S, S - ty);
  const t = ppm * 0.15;
  for (let y = ty; y < S; y += t) for (let x = 0; x < S; x += t) {
    const k = 0.85 + R() * 0.15;
    g.fillStyle = rgbStr(205 * k, 205 * k, 196 * k); g.fillRect(x + 1, y + 1, t - 2, t - 2);
    if (R() < 0.06) { g.fillStyle = 'rgba(40,36,30,0.85)'; blobPath(g, x + t / 2, y + t / 2, t * 0.5, t * 0.4, R, 7, 0.6); g.fill(); }
  }
  g.fillStyle = '#4c5a4c'; g.fillRect(0, ty - 6, S, 6);
  // Peeling paint, damp, streaks, blood.
  for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(185,180,165,0.6)'; blobPath(g, R() * S, R() * ty, 6 + R() * 18, 4 + R() * 10, R, 10, 0.8); g.fill(); }
  blendTile(g, noiseMask(133, [70, 64, 45], 0.55, 0.85, 256, 4), 'source-over', 0.55, 2);
  for (let x = 0; x < S; x += 10) if (R() < 0.4) streaks(g, x, 0, 10, 100 + R() * 250, R, 2, 0.3);
  const gr = g.createLinearGradient(0, S, 0, S - ppm * 0.8);
  gr.addColorStop(0, 'rgba(40,35,25,0.6)'); gr.addColorStop(1, 'rgba(40,35,25,0)');
  g.fillStyle = gr; g.fillRect(0, S - ppm * 0.8, S, ppm * 0.8);
  splatter(g, S * 0.7, ty + 20, 50, R, 50);
  streaks(g, S * 0.7, ty + 10, 30, 120, R, 6, 0.6, '90,12,8');
  desaturate(g, 0.3);
  grain(g, 0.1);
  return c;
}

// Pharmacy floor: grey/beige terrazzo-ish checker tiles. [2,2] m.
export function tiles() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(1111);
  const n = 8, t = S / n;
  g.fillStyle = '#2a2724'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.85 + R() * 0.15, dark = (x + y) & 1;
    g.fillStyle = dark ? rgbStr(90 * k, 92 * k, 90 * k) : rgbStr(180 * k, 172 * k, 156 * k);
    g.fillRect(x * t + 1.5, y * t + 1.5, t - 3, t - 3);
    if (R() < 0.15) crack(g, x * t + R() * t, y * t + R() * t, t * 0.8, R, 'rgba(20,18,15,0.7)', 1, R() * 6);
  }
  blendTile(g, noiseTile(141, 256, 8), 'overlay', 0.3, 1);
  blendTile(g, noiseMask(143, [45, 40, 32], 0.5, 0.85, 256, 4), 'source-over', 0.6, 2);
  // Dried blood trail + footprints.
  for (let i = 0; i < 2; i++) { const x = R() * S, y = R() * S; wrapDraw(S, S, x, y, 80, (X, Y) => splatter(g, X, Y, 70, R, 60)); }
  for (let i = 0; i < 6; i++) {
    const x = 60 + i * 70, y = 300 + Math.sin(i) * 40 + (i & 1) * 18;
    g.fillStyle = 'rgba(70,14,10,0.45)'; g.beginPath(); g.ellipse(x, y, 11, 5, 0.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + 17, y, 6, 4.5, 0, 0, Math.PI * 2); g.fill();
  }
  desaturate(g, 0.25);
  grain(g, 0.12);
  return c;
}

// Blood decal with alpha: pool + splatter + smear.
export function blood() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(1212);
  const cx = S / 2, cy = S / 2;
  g.save();
  g.fillStyle = 'rgba(60,6,5,0.9)';
  blobPath(g, cx, cy, 120, 90, R, 24, 0.5); g.fill();
  g.fillStyle = 'rgba(35,3,3,0.75)';
  blobPath(g, cx + 10, cy + 5, 80, 60, R, 20, 0.5); g.fill();
  // Glossy wet edge.
  g.strokeStyle = 'rgba(110,20,15,0.6)'; g.lineWidth = 3; blobPath(g, cx, cy, 118, 88, R, 24, 0.5); g.stroke();
  // Smear trail.
  for (let i = 0; i < 9; i++) {
    const y = cy + (R() - 0.5) * 60;
    const gr = g.createLinearGradient(cx, 0, S - 20, 0);
    gr.addColorStop(0, 'rgba(70,8,6,0.7)'); gr.addColorStop(1, 'rgba(70,8,6,0)');
    g.fillStyle = gr; g.fillRect(cx, y, S / 2 - 20, 3 + R() * 8);
  }
  splatter(g, cx, cy, 230, R, 160, [95, 10, 8]);
  g.restore();
  // Texture only inside the alpha.
  g.save(); g.globalCompositeOperation = 'source-atop';
  blendTile(g, noiseTile(151, 256, 8), 'source-atop', 0.15, 1);
  g.restore();
  // Fade the edges to zero alpha so repeat-wrap never shows seams.
  g.save(); g.globalCompositeOperation = 'destination-in';
  const rg = g.createRadialGradient(cx, cy, S * 0.35, cx, cy, S * 0.5);
  rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  g.restore();
  return c;
}
