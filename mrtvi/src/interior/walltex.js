// Pharmacy wall: green-grey plaster over a 1.5 m band of small cream tiles, 6 × 3 m per repeat so
// the grime doesn't visibly stamp. Splats vary in size, rotation and density (clustered, not one per
// tile); some run into drips that follow the grout and end in a bead.
import { rng } from '../layout.js';
import { canvas, noiseTile, noiseMask, blendTile, grain, desaturate, rgbStr, blobPath, streaks, wrapDraw, splatter } from '../tex/paint.js';

export const WALL_METRES = [6, 3];

export function interiorWallTex() {
  const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d'), R = rng(7713);
  const ppm = H / 3, ty = H - 1.5 * ppm, t = ppm * 0.15;
  g.fillStyle = '#9fae9c'; g.fillRect(0, 0, W, ty);
  blendTile(g, noiseTile(131, 256, 4), 'overlay', 0.4, 2);
  g.fillStyle = '#6f685e'; g.fillRect(0, ty, W, H - ty);
  for (let y = ty; y < H - 0.5; y += t) for (let x = 0; x < W - 0.5; x += t) {
    const k = 0.84 + R() * 0.16;
    g.fillStyle = rgbStr(205 * k, 205 * k, 196 * k); g.fillRect(x + 1, y + 1, t - 2, t - 2);
    if (R() < 0.025) { g.fillStyle = 'rgba(60,55,45,0.35)'; g.fillRect(x + 1 + R() * t * 0.5, y + 1, t * 0.4, t - 2); }   // chipped glaze
  }
  g.fillStyle = '#4c5a4c'; g.fillRect(0, ty - 6, W, 6);
  // peeling paint, damp, streaks down the plaster
  for (let i = 0; i < 22; i++) { g.fillStyle = 'rgba(185,180,165,0.6)'; blobPath(g, R() * W, R() * ty, 6 + R() * 22, 4 + R() * 12, R, 10, 0.8); g.fill(); }
  blendTile(g, noiseMask(133, [70, 64, 45], 0.55, 0.85, 256, 4), 'source-over', 0.5, 2);
  for (let x = 0; x < W; x += 10) if (R() < 0.35) streaks(g, x, 0, 10, 80 + R() * 260, R, 2, 0.3);

  // grime: dark splats in a few clusters of uneven density, random size + rotation, with drips
  const drip = (x, y, len, w, a) => {
    g.save(); g.strokeStyle = `rgba(28,24,18,${a})`; g.lineCap = 'round'; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    let cx = x, cy = y;
    while (cy < y + len) { cy += 3 + R() * 5; cx += (R() - 0.5) * 0.9; g.lineTo(cx, cy); }
    g.stroke();
    g.fillStyle = `rgba(22,18,14,${Math.min(1, a + 0.1)})`; g.beginPath(); g.ellipse(cx, cy + w * 0.4, w * 0.9, w * 1.4, 0, 0, 7); g.fill();
    g.restore();
  };
  const splat = (x, y, r, a) => wrapDraw(W, H, x, y, r * 3 + 140, (X, Y) => {
    g.save(); g.translate(X, Y); g.rotate(R() * Math.PI * 2);
    g.fillStyle = `rgba(32,28,22,${a})`;
    blobPath(g, 0, 0, r, r * (0.45 + R() * 0.55), R, 9 + (R() * 6 | 0), 0.5 + R() * 0.5); g.fill();
    for (let k = 0, n = (R() * 7) | 0; k < n; k++) {
      const an = R() * 6.28, d = r * (1.1 + R() * 1.4), s = 0.8 + R() * r * 0.22;
      g.beginPath(); g.ellipse(Math.cos(an) * d, Math.sin(an) * d, s * (1 + R()), s, an, 0, 7); g.fill();
    }
    g.restore();
    if (R() < 0.45) for (let k = 0, n = 1 + (R() * 3 | 0); k < n; k++) drip(X + (R() - 0.5) * r * 1.4, Y + r * 0.3, 12 + R() * R() * 140, 0.8 + R() * 2.2, a * (0.6 + R() * 0.3));
  });
  const clusters = [[0.12, 0.8, 9], [0.43, 0.55, 3], [0.58, 0.9, 14], [0.86, 0.7, 5], [0.3, 0.25, 2]];
  for (const [cx, cy, n] of clusters) {
    for (let i = 0; i < n; i++) {
      const x = cx * W + (R() - 0.5) * 220 * (0.4 + R()), y = ty + (cy * (H - ty)) + (R() - 0.5) * 120;
      const r = t * (0.15 + Math.pow(R(), 2.2) * 1.6);
      splat(x, Math.min(H - 8, Math.max(ty - 30, y)), r, 0.55 + R() * 0.4);
    }
  }
  for (let i = 0; i < 16; i++) splat(R() * W, ty + R() * (H - ty), t * (0.08 + R() * 0.25), 0.4 + R() * 0.4);   // stray flecks
  // damp running down from the dado rail
  for (let i = 0; i < 26; i++) drip(R() * W, ty + 2, 20 + R() * R() * 170, 0.7 + R() * 1.6, 0.25 + R() * 0.35);
  const gr = g.createLinearGradient(0, H, 0, H - ppm * 0.8);
  gr.addColorStop(0, 'rgba(40,35,25,0.6)'); gr.addColorStop(1, 'rgba(40,35,25,0)');
  g.fillStyle = gr; g.fillRect(0, H - ppm * 0.8, W, ppm * 0.8);
  splatter(g, W * 0.37, ty + 26, 50, R, 50);
  streaks(g, W * 0.37, ty + 14, 30, 120, R, 6, 0.6, '90,12,8');
  desaturate(g, 0.3);
  grain(g, 0.1);
  return c;
}

// Dark front-door pane: fogged, dirty glass with a faint cold gradient and condensation runs.
export function fogGlassTex() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d'), R = rng(919);
  const gr = g.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, '#5d6f88'); gr.addColorStop(0.55, '#3a4658'); gr.addColorStop(1, '#222a35');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {                                     // fog mottling
    const x = R() * S, y = R() * S, r = 4 + R() * 22, a = 0.04 + R() * 0.1;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(190,205,225,${a})`); rg.addColorStop(1, 'rgba(190,205,225,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14; i++) {                                     // runs wiped through the fog
    let x = R() * S, y = R() * S * 0.6; const len = 15 + R() * 70, w = 0.8 + R() * 1.6;
    g.strokeStyle = 'rgba(8,12,18,0.55)'; g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < len; s += 4) { x += (R() - 0.5) * 1.2; y += 4; g.lineTo(x, y); }
    g.stroke();
    g.fillStyle = 'rgba(200,215,235,0.35)'; g.beginPath(); g.arc(x, y + 1, w * 0.9, 0, 7); g.fill();
  }
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(14,12,10,${0.2 + R() * 0.3})`; blobPath(g, R() * S, R() * S, 3 + R() * 10, 2 + R() * 7, R, 9, 0.7); g.fill(); }   // grime
  const e = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);   // dirt in the corners
  e.addColorStop(0, 'rgba(10,10,10,0)'); e.addColorStop(1, 'rgba(10,10,10,0.75)');
  g.fillStyle = e; g.fillRect(0, 0, S, S);
  return c;
}
