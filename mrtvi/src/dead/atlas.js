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

// Cloth is read as cloth, not camouflage: a flat dyed base, a fine weave, a few soft stains,
// one or two crusts of old blood and small tears — no blotchy mottle (that is the skin's).
// Tiles: 0 denim, 1 canvas jacket, 2 check shirt (soft), 3 hi-vis, 4 scrubs, 5 suit.
function paintCloth(ctx, x0, y0, i) {
  const R = rng(700 + i);
  const kind = i % 6;
  const base = [[64, 76, 98], [86, 80, 58], [118, 124, 130], [150, 150, 70], [84, 120, 120], [50, 51, 56]][kind];
  ctx.fillStyle = `rgb(${base})`; ctx.fillRect(x0, y0, S, S);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
  // weave: warp + weft threads; denim is a diagonal twill
  if (kind === 0) {
    ctx.strokeStyle = 'rgba(210,215,230,0.13)'; ctx.lineWidth = 1;
    for (let k = -S; k < S * 2; k += 3) { ctx.beginPath(); ctx.moveTo(x0 + k, y0); ctx.lineTo(x0 + k + S, y0 + S); ctx.stroke(); }
  } else {
    for (let y = 0; y < S; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.06 + ((y * 7) % 5) * 0.008})`; ctx.fillRect(x0, y0 + y, S, 1); }
    for (let x = 0; x < S; x += 2) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(x0 + x, y0, 1, S); }
  }
  if (kind === 1) {   // stitched seams
    ctx.strokeStyle = 'rgba(25,22,15,0.45)'; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0 + 64); ctx.lineTo(x0 + S, y0 + 64); ctx.moveTo(x0, y0 + 192); ctx.lineTo(x0 + S, y0 + 192); ctx.stroke(); ctx.setLineDash([]);
  } else if (kind === 2) {   // plaid at half contrast
    for (let k = 0; k < S; k += 32) {
      ctx.fillStyle = 'rgba(120,40,40,0.22)'; ctx.fillRect(x0 + k, y0, 10, S); ctx.fillRect(x0, y0 + k, S, 10);
      ctx.fillStyle = 'rgba(30,30,40,0.17)'; ctx.fillRect(x0 + k + 18, y0, 3, S); ctx.fillRect(x0, y0 + k + 18, S, 3);
    }
  } else if (kind === 3) {   // dulled reflective bands
    for (const y of [70, 170]) { ctx.fillStyle = 'rgba(140,143,140,0.7)'; ctx.fillRect(x0, y0 + y, S, 22); }
  } else if (kind === 5) {   // faint pinstripe
    for (let x = 0; x < S; x += 16) { ctx.fillStyle = 'rgba(170,170,170,0.1)'; ctx.fillRect(x0 + x, y0, 1, S); }
  }
  ctx.restore();
  // a few soft stains (sweat, mud, water marks) with a darker tide line
  const stains = [];
  for (let k = 0; k < 3; k++) stains.push([R() * S, R() * S, 18 + R() * 26, 0.16 + R() * 0.14]);
  wrapped(ctx, x0, y0, (c) => {
    for (const [x, y, r, a] of stains) {
      const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, `rgba(70,58,40,${a})`); g.addColorStop(0.85, `rgba(70,58,40,${a * 0.8})`); g.addColorStop(1, 'rgba(70,58,40,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      c.strokeStyle = `rgba(50,40,28,${a})`; c.lineWidth = 1.2; c.beginPath(); c.ellipse(x, y, r * 0.88, r * 0.8, 0, 0, Math.PI * 2); c.stroke();
    }
  });
  // old blood: one or two crusts with a drip
  const crusts = [];
  for (let k = 0; k < 1 + (i % 2); k++) crusts.push([R() * S, R() * S, 6 + R() * 12, 20 + R() * 50]);
  wrapped(ctx, x0, y0, (c) => {
    for (const [x, y, r, l] of crusts) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(40,10,6,0.8)'); g.addColorStop(0.7, 'rgba(48,14,8,0.6)'); g.addColorStop(1, 'rgba(48,14,8,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      c.fillStyle = 'rgba(42,12,7,0.5)'; c.fillRect(x - 1.5, y, 3, l);
    }
  });
  // tears: small dark ragged holes
  const holes = [];
  for (let k = 0; k < 2; k++) {
    const x = R() * S, y = R() * S, r = 3 + R() * 7, pts = [];
    for (let a = 0; a < 6.28; a += 0.6) { const rr = r * (0.5 + R() * 0.7); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6]); }
    holes.push(pts);
  }
  wrapped(ctx, x0, y0, (c) => {
    c.fillStyle = 'rgba(12,9,7,0.9)';
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
    // skin may come from the textures module; cloth is always ours (its mottle read as camouflage)
    if (key !== 'cloth') { try { const f = game.tex && game.tex[key]; if (typeof f === 'function') im = drawable(f(i)); } catch { im = null; } }
    if (im) { ctx.drawImage(im, 0, 0, im.width, im.height, x0, y0, S, S); fromModule++; }
    else painter(ctx, x0, y0, i);
  }
  // mean linear luminance per tile, so callers can set absolute clothing values
  const mean = [];
  try {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < n; i++) {
      const d = ctx.getImageData((i % cols) * S, Math.floor(i / cols) * S, S, S).data;
      let sum = 0, k = 0;
      for (let j = 0; j < d.length; j += 4 * 37) { sum += 0.2126 * lin(d[j]) + 0.7152 * lin(d[j + 1]) + 0.0722 * lin(d[j + 2]); k++; }
      mean.push(Math.max(0.01, sum / Math.max(1, k)));
    }
  } catch { for (let i = 0; i < n; i++) mean.push(0.07); }
  const t = new THREE.CanvasTexture(cv);
  t.userData.mean = mean;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.userData.fromModule = fromModule;
  return t;
}

export function makeAtlases(game) {
  return { skin: atlas(game, 'skin', 4, 2, 2, paintSkin), cloth: atlas(game, 'cloth', 6, 3, 2, paintCloth) };
}
