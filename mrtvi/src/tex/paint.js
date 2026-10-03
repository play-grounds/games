// Low-level canvas painting helpers for the procedural textures. No image files.
import { rng } from '../layout.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Tileable fBm value noise as a grey canvas (cached per key).
const noiseCache = new Map();
export function noiseTile(seed, size = 256, cells = 4, octaves = 5, gain = 0.5) {
  const key = `${seed}|${size}|${cells}|${octaves}|${gain}`;
  if (noiseCache.has(key)) return noiseCache.get(key);
  const R = rng(seed);
  const acc = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    if (n > size) break;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    const f = n / size;
    const sx = new Int32Array(size), tx = new Float32Array(size);
    for (let x = 0; x < size; x++) { const v = x * f; sx[x] = v | 0; const t = v - sx[x]; tx[x] = t * t * (3 - 2 * t); }
    for (let y = 0; y < size; y++) {
      const y0 = sx[y], y1 = (y0 + 1) % n, ty = tx[y];
      const r0 = y0 * n, r1 = y1 * n;
      for (let x = 0; x < size; x++) {
        const x0 = sx[x], x1 = (x0 + 1) % n, t = tx[x];
        const a = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * t;
        const b = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * t;
        acc[y * size + x] += amp * (a + (b - a) * ty);
      }
    }
    total += amp; amp *= gain;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < acc.length; i++) { const v = acc[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < acc.length; i++) {
    const v = ((acc[i] - mn) / (mx - mn)) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseCache.set(key, c);
  return c;
}

// Same noise as alpha-only mask of a colour, thresholded softly: where noise > lo it shows.
const maskCache = new Map();
export function noiseMask(seed, rgb, lo = 0.5, hi = 0.75, size = 256, cells = 4) {
  const key = `${seed}|${rgb}|${lo}|${hi}|${size}|${cells}`;
  if (maskCache.has(key)) return maskCache.get(key);
  const src = noiseTile(seed, size, cells).getContext('2d').getImageData(0, 0, size, size).data;
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = src[i * 4] / 255;
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = t * t * (3 - 2 * t) * 255;
  }
  g.putImageData(img, 0, 0);
  maskCache.set(key, c);
  return c;
}

// Fill the whole canvas with a pattern of `tile` using a blend mode. Scale keeps it tileable
// as long as canvas size is a multiple of tile*scale.
export function blendTile(g, tile, mode, alpha, scale = 1, ox = 0, oy = 0) {
  const { width: w, height: h } = g.canvas;
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  const p = g.createPattern(tile, 'repeat');
  p.setTransform(new DOMMatrix([scale, 0, 0, scale, ox, oy]));
  g.fillStyle = p;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// Fine grain (per-pixel white noise), cached.
let grainC = null;
export function grain(g, alpha = 0.12, mode = 'overlay') {
  if (!grainC) {
    const s = 128, R = rng(777);
    grainC = canvas(s, s);
    const gg = grainC.getContext('2d'), img = gg.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = R() * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    gg.putImageData(img, 0, 0);
  }
  blendTile(g, grainC, mode, alpha);
}

export function desaturate(g, amount = 0.3) {
  const { width: w, height: h } = g.canvas;
  g.save();
  g.globalCompositeOperation = 'saturation';
  g.globalAlpha = amount;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  g.restore();
}

export function rgbStr(r, g, b, a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
export function hex(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
export function shade([r, g, b], k, a = 1) { return rgbStr(Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k), a); }
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// Draw fn at (x,y) and at wrapped copies so the canvas tiles seamlessly.
export function wrapDraw(w, h, x, y, rad, fn) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const X = x + dx, Y = y + dy;
    if (X + rad < 0 || X - rad > w || Y + rad < 0 || Y - rad > h) continue;
    fn(X, Y);
  }
}

// Irregular blob path (for stains, plaster loss, moss).
export function blobPath(g, x, y, rx, ry, R, n = 14, rough = 0.35) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - rough / 2 + R() * rough;
    const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

// Soft radial stain with blend mode.
export function stain(g, x, y, r, col, alpha, mode = 'multiply') {
  g.save();
  g.globalCompositeOperation = mode;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col.replace(/[\d.]+\)$/, `${alpha})`));
  gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

// Random-walk crack.
export function crack(g, x, y, len, R, col = 'rgba(20,18,16,0.7)', w = 1, dir = Math.PI / 2) {
  g.save();
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y);
  let a = dir;
  for (let s = 0; s < len; s += 4) {
    a += (R() - 0.5) * 0.9;
    x += Math.cos(a) * 4; y += Math.sin(a) * 4;
    g.lineTo(x, y);
    if (R() < 0.06) { const sub = len * 0.3 * R(); crack(g, x, y, sub, R, col, w * 0.7, a + (R() - 0.5) * 2); }
  }
  g.stroke();
  g.restore();
}

// Vertical grime streaks running down from (x,y).
export function streaks(g, x, y, width, len, R, n = 6, alpha = 0.3, col = '30,26,20') {
  g.save();
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < n; i++) {
    const sx = x + (R() - 0.5) * width, sw = 1 + R() * 4, sl = len * (0.3 + R() * 0.7);
    const gr = g.createLinearGradient(0, y, 0, y + sl);
    const a = alpha * (0.4 + R() * 0.6);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(sx, y, sw, sl);
  }
  g.restore();
}

// Spray-painted text with overspray and drips.
export function spray(g, text, x, y, size, col, R, rot = 0) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.font = `900 ${size}px "Arial Black", Impact, "DejaVu Sans", sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = col; g.strokeStyle = col;
  g.shadowColor = col; g.shadowBlur = size * 0.18;
  g.globalAlpha = 0.55;
  g.fillText(text, 1, 1);
  g.globalAlpha = 0.8;
  g.shadowBlur = size * 0.06;
  g.fillText(text, 0, 0);
  g.shadowBlur = 0;
  const w = g.measureText(text).width;
  g.lineWidth = Math.max(1, size * 0.04);
  for (let i = 0, n = 2 + (R() * text.length) | 0; i < n; i++) {
    const dx = R() * w, l = size * (0.2 + R() * 0.9);
    g.globalAlpha = 0.5 + R() * 0.3;
    g.beginPath(); g.moveTo(dx, -size * 0.05); g.lineTo(dx + (R() - 0.5) * 2, l); g.stroke();
    g.beginPath(); g.arc(dx, l, g.lineWidth * 0.8, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// Spray strokes (tally marks, X marks).
export function sprayLine(g, pts, width, col, R) {
  g.save();
  g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = col; g.shadowBlur = width * 0.8;
  g.lineWidth = width; g.globalAlpha = 0.8;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x + (R() - 0.5), y + (R() - 0.5)) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

// Bloody hand print smeared downward.
export function bloodHand(g, x, y, s, R, rot = 0) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  const col = `rgba(${70 + R() * 30},${8 + R() * 8},${6},0.85)`;
  g.fillStyle = col; g.globalCompositeOperation = 'multiply';
  // palm
  g.beginPath(); g.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, Math.PI * 2); g.fill();
  // fingers
  for (let f = 0; f < 4; f++) {
    const fx = -s * 0.36 + f * s * 0.24, fl = s * (0.55 + (f === 1 || f === 2 ? 0.15 : 0));
    g.beginPath(); g.ellipse(fx, -s * 0.5 - fl * 0.45, s * 0.09, fl * 0.5, 0, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.ellipse(s * 0.5, -s * 0.05, s * 0.09, s * 0.3, -0.7, 0, Math.PI * 2); g.fill();
  // smear down
  for (let i = 0; i < 6; i++) {
    const dx = (R() - 0.5) * s * 0.8, l = s * (0.8 + R() * 2.2);
    const gr = g.createLinearGradient(0, 0, 0, l);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(60,10,6,0)');
    g.fillStyle = gr;
    g.fillRect(dx - s * 0.06, 0, s * (0.06 + R() * 0.1), l);
  }
  g.restore();
}

// Splatter of blood drops around a point.
export function splatter(g, x, y, r, R, n = 40, col = [80, 10, 8]) {
  g.save();
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = r * Math.pow(R(), 1.6);
    const s = (1 - d / r) * r * 0.08 + 0.6;
    g.fillStyle = rgbStr(col[0] * (0.7 + R() * 0.5), col[1], col[2], 0.6 + R() * 0.35);
    g.beginPath(); g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, s * (1 + R()), s, a, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// Bullet hole: dark centre, chipped light ring.
export function bulletHole(g, x, y, r, R) {
  g.save();
  g.fillStyle = 'rgba(230,220,200,0.35)';
  blobPath(g, x, y, r * 2.2, r * 2, R, 9, 0.6); g.fill();
  g.fillStyle = 'rgba(15,12,10,0.9)';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.restore();
}
