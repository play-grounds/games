// Texture atlases for the dead: skin (2×2 tiles) and cloth (3×2 tiles). Tiles come from
// game.tex.skin(i) / game.tex.cloth(i) when the textures module provides drawable images;
// otherwise they are painted here (seamless, so the uv wrap on limbs doesn't show).
import * as THREE from 'three';
import { rng } from '../layout.js';

const S = 256;

function drawable(t) {
  const im = t && t.image;
  if (!im || !(im.width > 0)) return null;
  if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) return im;
  if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) return im;
  if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement && im.complete) return im;
  if (typeof OffscreenCanvas !== 'undefined' && im instanceof OffscreenCanvas) return im;
  return null;
}

// draw fn at 9 wrapped offsets, clipped to the tile → seamless tile
function wrapped(ctx, x0, y0, fn) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { ctx.save(); ctx.translate(x0 + i * S, y0 + j * S); fn(ctx); ctx.restore(); }
  ctx.restore();
}

function blobs(ctx, x0, y0, R, n, rMin, rMax, col, aMin, aMax) {
  const list = [];
  for (let k = 0; k < n; k++) list.push([R() * S, R() * S, rMin + R() * (rMax - rMin), aMin + R() * (aMax - aMin)]);
  wrapped(ctx, x0, y0, (c) => {
    for (const [x, y, r, a] of list) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function paintSkin(ctx, x0, y0, i) {
  const R = rng(500 + i);
  const base = [[112, 122, 96], [136, 134, 114], [124, 118, 86], [96, 100, 84]][i % 4];
  ctx.fillStyle = `rgb(${base})`; ctx.fillRect(x0, y0, S, S);
  blobs(ctx, x0, y0, R, 160, 4, 22, '40,48,30', 0.05, 0.22);          // mottling
  blobs(ctx, x0, y0, R, 90, 3, 14, '190,190,160', 0.04, 0.14);        // pallor
  blobs(ctx, x0, y0, R, 6, 20, 50, '70,40,70', 0.15, 0.35);           // bruises
  blobs(ctx, x0, y0, R, 5, 12, 30, '120,120,40', 0.1, 0.25);          // jaundice
  blobs(ctx, x0, y0, R, 14, 2, 7, '60,10,8', 0.4, 0.8);               // sores
  // veins
  const veins = [];
  for (let k = 0; k < 18; k++) {
    let x = R() * S, y = R() * S, a = R() * 6.28; const p = [[x, y]];
    for (let s = 0; s < 14; s++) { a += (R() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; p.push([x, y]); }
    veins.push(p);
  }
  wrapped(ctx, x0, y0, (c) => {
    c.strokeStyle = 'rgba(55,40,75,0.35)'; c.lineWidth = 1.2;
    for (const p of veins) { c.beginPath(); c.moveTo(...p[0]); for (const q of p) c.lineTo(...q); c.stroke(); }
  });
}

function paintCloth(ctx, x0, y0, i) {
  const R = rng(700 + i);
  const base = [[62, 70, 82], [84, 70, 54], [60, 66, 52], [98, 94, 88], [82, 52, 48], [44, 47, 55]][i % 6];
  ctx.fillStyle = `rgb(${base})`; ctx.fillRect(x0, y0, S, S);
  // weave
  ctx.globalAlpha = 0.07;
  for (let y = 0; y < S; y += 2) { ctx.fillStyle = y % 4 ? '#000' : '#fff'; ctx.fillRect(x0, y0 + y, S, 1); }
  for (let x = 0; x < S; x += 3) { ctx.fillStyle = '#000'; ctx.fillRect(x0 + x, y0, 1, S); }
  ctx.globalAlpha = 1;
  if (i % 3 === 1) { // checks / stripes on some
    ctx.globalAlpha = 0.12; ctx.fillStyle = '#000';
    for (let x = 0; x < S; x += 32) ctx.fillRect(x0 + x, y0, 8, S);
    if (i === 4) for (let y = 0; y < S; y += 32) ctx.fillRect(x0, y0 + y, S, 8);
    ctx.globalAlpha = 1;
  }
  blobs(ctx, x0, y0, R, 40, 10, 40, '30,26,20', 0.08, 0.3);           // grime
  blobs(ctx, x0, y0, R, 20, 6, 26, '150,140,120', 0.04, 0.12);        // fading
  blobs(ctx, x0, y0, R, 10, 6, 30, '45,6,4', 0.35, 0.75);             // old blood
  // tears: dark ragged holes
  const holes = [];
  for (let k = 0; k < 4; k++) {
    const x = R() * S, y = R() * S, r = 4 + R() * 10, pts = [];
    for (let a = 0; a < 6.28; a += 0.6) { const rr = r * (0.5 + R() * 0.7); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6]); }
    holes.push(pts);
  }
  wrapped(ctx, x0, y0, (c) => {
    c.fillStyle = 'rgba(15,10,8,0.85)';
    for (const pts of holes) { c.beginPath(); for (const p of pts) c.lineTo(p[0], p[1]); c.fill(); }
  });
}

function atlas(game, key, n, cols, rows, painter) {
  const cv = document.createElement('canvas');
  cv.width = cols * S; cv.height = rows * S;
  const ctx = cv.getContext('2d');
  let fromModule = 0;
  for (let i = 0; i < n; i++) {
    const x0 = (i % cols) * S, y0 = Math.floor(i / cols) * S;
    let im = null;
    try { const f = game.tex && game.tex[key]; if (typeof f === 'function') im = drawable(f(i)); } catch { im = null; }
    if (im) { ctx.drawImage(im, 0, 0, im.width, im.height, x0, y0, S, S); fromModule++; }
    else painter(ctx, x0, y0, i);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.userData.fromModule = fromModule;
  return t;
}

export function makeAtlases(game) {
  return { skin: atlas(game, 'skin', 4, 2, 2, paintSkin), cloth: atlas(game, 'cloth', 6, 3, 2, paintCloth) };
}
