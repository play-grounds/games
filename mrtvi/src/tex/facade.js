// Baroque Prague façade, three storeys, decayed. Tileable horizontally.
import { rng } from '../layout.js';
import {
  canvas, noiseTile, noiseMask, blendTile, grain, desaturate, rgbStr, hex, shade, mix,
  blobPath, stain, crack, streaks, spray, sprayLine, bloodHand, bulletHole,
} from './paint.js';

const PALETTE = [0xc4a25e, 0xd3c6a2, 0xc28f76, 0xa3ad88, 0x8e9ba6, 0xc19d93, 0xcbb46e, 0xb0aa9c].map(hex);
const SHUTTER = [0x4a5a44, 0x5b4636, 0x3e4a52, 0x6a6a58].map(hex);
const WORDS = ['MRTVÍ', 'POMOC', 'NEJSOU TU', 'NECHOĎ DÁL', 'ŽIJEME', 'KONEC', 'MRTVÍ', 'HRAD →', 'NEVSTUPOVAT', 'BŮH NÁS OPUSTIL'];
const SHOPS = ['POTRAVINY', 'TABÁK', 'SMĚNÁRNA', 'KAVÁRNA', 'PIVNICE', 'GRANÁT', 'SUVENÝRY', 'PEKAŘSTVÍ', 'BAR', 'ANTIKVARIÁT'];
const SPRAY_COLS = ['rgba(150,20,16,1)', 'rgba(20,20,20,1)', 'rgba(210,205,190,1)', 'rgba(170,90,30,1)', 'rgba(150,20,16,1)'];

// Storey heights in metres (from ground): plinth, ground floor, string course, piano nobile, band, second, cornice.
const H = 12;

export function paintFacade(seed, bays, ppm = 512 / 12) {
  const R = rng(seed * 7919 + 13);
  const W = Math.round(bays * 3 * ppm), Hp = Math.round(H * ppm);
  const c = canvas(W, Hp), g = c.getContext('2d');
  const Y = (m) => Hp - m * ppm;              // metres above ground → canvas y
  const M = (m) => m * ppm;
  const base = mix(PALETTE[seed % PALETTE.length], [150, 145, 135], 0.15 + R() * 0.15);
  const trim = mix(base, [225, 218, 200], 0.45);
  const dark = shade(base, 0.55);

  // Plaster body + mottling.
  g.fillStyle = rgbStr(...base); g.fillRect(0, 0, W, Hp);
  blendTile(g, noiseTile(11 + (seed % 3), 256, 3), 'overlay', 0.55, 2);
  blendTile(g, noiseTile(21, 256, 8, 4), 'soft-light', 0.5, 1, R() * 256);
  // Rusticated ground floor (horizontal joints) and plinth.
  g.fillStyle = shade(base, 0.82); g.fillRect(0, Y(4.2), W, M(3.6));
  g.fillStyle = 'rgba(40,34,28,0.35)';
  for (let m = 0.6 + 0.45; m < 4.2; m += 0.45) g.fillRect(0, Y(m), W, 2);
  g.fillStyle = shade(mix(base, [110, 108, 104], 0.6), 0.8); g.fillRect(0, Y(0.6), W, M(0.6));
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, Y(0.6), W, 2);

  // Cornices: string course 4.2–4.6, band 8.0–8.2, main cornice 11.0–12.
  const cornice = (m0, m1, dentils) => {
    g.fillStyle = rgbStr(...trim); g.fillRect(0, Y(m1), W, M(m1 - m0));
    g.fillStyle = 'rgba(255,250,235,0.18)'; g.fillRect(0, Y(m1), W, 2);
    g.fillStyle = shade(trim, 0.7); g.fillRect(0, Y(m0 + (m1 - m0) * 0.35), W, 2);
    const sh = g.createLinearGradient(0, Y(m0), 0, Y(m0) + M(0.35));
    sh.addColorStop(0, 'rgba(15,12,10,0.55)'); sh.addColorStop(1, 'rgba(15,12,10,0)');
    g.fillStyle = sh; g.fillRect(0, Y(m0), W, M(0.35));
    if (dentils) {
      g.fillStyle = shade(trim, 0.6);
      const step = M(0.25);
      for (let x = step * 0.25; x < W; x += step) g.fillRect(x, Y(m0 + 0.35), step * 0.5, M(0.18));
    }
  };
  cornice(11.0, 12, true);
  cornice(8.0, 8.2, false);
  cornice(4.2, 4.6, false);
  // Frieze below the top cornice.
  g.fillStyle = shade(base, 0.92); g.fillRect(0, Y(11.0), W, M(0.3));

  // Plaster loss → brick showing.
  for (let i = 0, n = 1 + (R() * 3) | 0; i < n; i++) {
    const x = R() * W, y = Y(1 + R() * 9), rx = M(0.4 + R() * 1.2), ry = M(0.3 + R() * 0.8);
    g.save();
    blobPath(g, x, y, rx, ry, R, 18, 0.6);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.translate(1.5, 1.5); g.fill(); g.translate(-1.5, -1.5);
    g.clip();
    g.fillStyle = '#5e4a3e'; g.fillRect(x - rx * 1.3, y - ry * 1.3, rx * 2.6, ry * 2.6);
    const bh = M(0.075), bw = M(0.28);
    for (let yy = y - ry * 1.3, row = 0; yy < y + ry * 1.3; yy += bh, row++) {
      for (let xx = x - rx * 1.3 - (row % 2) * bw / 2; xx < x + rx * 1.3; xx += bw) {
        g.fillStyle = rgbStr(110 + R() * 40, 60 + R() * 25, 45 + R() * 20);
        g.fillRect(xx + 1, yy + 1, bw - 2, bh - 2);
      }
    }
    g.restore();
  }

  // Window bays.
  const bayW = 3 * ppm;
  const sills = [];
  const scorch = [];
  for (let b = 0; b < bays; b++) {
    const cx = (b + 0.5) * bayW;
    // Upper floors.
    for (const [bot, h, ped] of [[5.3, 2.2, true], [8.75, 1.8, false]]) {
      const ww = M(1.15), wh = M(h), x0 = cx - ww / 2, y0 = Y(bot + h);
      const roll = R();
      const state = roll < 0.42 ? 'glass' : roll < 0.56 ? 'shutters' : roll < 0.76 ? 'broken' : roll < 0.88 ? 'boarded' : 'dark';
      const burnt = scorch.length < 1 + (bays > 4) && R() < 0.07;
      window_(g, x0, y0, ww, wh, burnt ? 'broken' : state, R, trim, ppm);
      // Surround.
      const f = M(0.16);
      g.fillStyle = rgbStr(...trim);
      g.fillRect(x0 - f, y0 - f, f, wh + f); g.fillRect(x0 + ww, y0 - f, f, wh + f); g.fillRect(x0 - f, y0 - f, ww + f * 2, f);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0 + ww + f, y0 - f, 2, wh + f);
      // Sill.
      g.fillStyle = shade(trim, 0.95); g.fillRect(x0 - f * 1.6, y0 + wh, ww + f * 3.2, M(0.12));
      g.fillStyle = 'rgba(10,8,6,0.45)'; g.fillRect(x0 - f * 1.6, y0 + wh + M(0.12), ww + f * 3.2, 3);
      // Apron panel under sill.
      g.strokeStyle = shade(trim, 0.85); g.lineWidth = 2;
      g.strokeRect(x0, y0 + wh + M(0.25), ww, M(0.45));
      if (ped) {
        // Pediment: triangle or segmental arc.
        const py = y0 - f, pw = ww + f * 3;
        g.fillStyle = rgbStr(...trim);
        g.beginPath();
        if (b % 2 === 0) { g.moveTo(cx - pw / 2, py); g.lineTo(cx, py - M(0.5)); g.lineTo(cx + pw / 2, py); }
        else { g.moveTo(cx - pw / 2, py); g.quadraticCurveTo(cx, py - M(0.7), cx + pw / 2, py); }
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(20,16,12,0.45)'; g.lineWidth = 2; g.stroke();
        g.fillStyle = 'rgba(15,12,10,0.4)'; g.fillRect(cx - pw / 2, py, pw, 3);
      } else {
        // Keystone.
        g.fillStyle = shade(trim, 1.05);
        g.beginPath(); g.moveTo(cx - M(0.12), y0 - f); g.lineTo(cx + M(0.12), y0 - f); g.lineTo(cx + M(0.17), y0 - f - M(0.3)); g.lineTo(cx - M(0.17), y0 - f - M(0.3)); g.closePath(); g.fill();
      }
      sills.push([cx, y0 + wh + M(0.12), ww]);
      if (burnt) scorch.push([cx, y0, ww, wh]);
    }
    // Ground floor.
    ground(g, cx, M, Y, R, base, trim, b, bays, ppm);
  }

  // Grime streaks under sills and from the cornice.
  for (const [x, y, w] of sills) streaks(g, x, y, w * 1.2, M(1.2 + R() * 2.2), R, 9, 0.38);
  for (let x = 0; x < W; x += M(0.4)) if (R() < 0.6) streaks(g, x, Y(11) + 3, M(0.3), M(1 + R() * 4), R, 2, 0.28);
  // Scorch: soot plume above burnt windows.
  for (const [x, y, ww, wh] of scorch) {
    g.save();
    g.beginPath(); g.rect(0, Y(10.95), W, Hp); g.clip();   // soot stops under the main cornice
    g.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 7; k++) {
      const r = M(0.55 + k * 0.16), yy = y + wh * 0.15 - M(k * 0.38), xx = x + (R() - 0.5) * M(0.35);
      const gr = g.createRadialGradient(xx, yy, 0, xx, yy, r);
      gr.addColorStop(0, `rgba(8,6,5,${0.75 - k * 0.07})`); gr.addColorStop(0.55, `rgba(22,18,14,${0.4 - k * 0.04})`); gr.addColorStop(1, 'rgba(40,30,20,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(xx, yy, r * 0.8, r, 0, 0, Math.PI * 2); g.fill();
    }
    // Sooty tongues licking up from the lintel.
    for (let k = 0; k < 9; k++) {
      const sx = x + (R() - 0.5) * ww, l = M(0.8 + R() * 1.6);
      const gr = g.createLinearGradient(0, y, 0, y - l);
      gr.addColorStop(0, 'rgba(5,4,3,0.6)'); gr.addColorStop(1, 'rgba(5,4,3,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(sx - M(0.12), y); g.quadraticCurveTo(sx + (R() - 0.5) * M(0.4), y - l * 0.6, sx + (R() - 0.5) * M(0.3), y - l); g.lineTo(sx + M(0.12), y); g.fill();
    }
    g.restore();
  }

  // Damp rising at the base.
  g.save();
  g.globalCompositeOperation = 'multiply';
  const dg = g.createLinearGradient(0, Hp, 0, Y(1.8));
  dg.addColorStop(0, 'rgba(60,62,48,0.85)'); dg.addColorStop(0.5, 'rgba(110,108,90,0.45)'); dg.addColorStop(1, 'rgba(160,150,130,0)');
  g.fillStyle = dg; g.fillRect(0, Y(1.8), W, M(1.8));
  g.restore();
  g.save();
  g.beginPath(); g.rect(0, Y(1.6), W, M(1.6)); g.clip();
  blendTile(g, noiseMask(31, [45, 48, 36], 0.45, 0.7, 256, 6), 'source-over', 0.7, 1, R() * 256, 0);
  g.restore();
  // Overall dirt + darker bottom, cracks, bullet holes.
  blendTile(g, noiseMask(41 + (seed % 2), [40, 36, 30], 0.6, 0.9, 256, 4), 'multiply', 0.35, 2, R() * 512);
  for (let i = 0, n = 2 + (R() * 4) | 0; i < n; i++) crack(g, R() * W, Y(4.6 + R() * 6), M(0.6 + R() * 1.5), R, 'rgba(25,20,16,0.6)', 1.2);
  if (R() < 0.45) {
    const x = R() * W, y = Y(1.2 + R() * 2.5);
    for (let i = 0; i < 12; i++) bulletHole(g, x + (R() - 0.5) * M(1.8), y + (R() - 0.5) * M(1.4), 2 + R() * 1.5, R);
  }

  // Graffiti on the ground floor.
  const nG = R() < 0.75 ? 1 + (R() * 2.2 | 0) : 0;
  for (let i = 0; i < nG; i++) {
    const word = WORDS[(R() * WORDS.length) | 0], size = M(0.35 + R() * 0.35);
    g.save(); g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    const tw = g.measureText(word).width; g.restore();
    const x = Math.min(W - tw - 4, Math.max(4, R() * (W - tw))), y = Y(1.0 + R() * 2.3);
    spray(g, word, x, y, size, SPRAY_COLS[(R() * SPRAY_COLS.length) | 0], R, (R() - 0.5) * 0.12);
  }
  if (R() < 0.35) { // tally marks
    const x = R() * (W - M(1.5)), y = Y(2.6), s = M(0.35), col = 'rgba(30,28,26,1)';
    for (let k = 0, n = 1 + (R() * 4 | 0); k < n; k++) {
      const gx = x + k * s * 1.4;
      for (let j = 0; j < 4; j++) sprayLine(g, [[gx + j * s * 0.25, y], [gx + j * s * 0.25 + 1, y + s]], 2.5, col, R);
      sprayLine(g, [[gx - s * 0.1, y + s * 0.85], [gx + s, y + s * 0.15]], 2.5, col, R);
    }
  }
  if (R() < 0.25) bloodHand(g, R() * (W - 40) + 20, Y(1.1 + R() * 0.6), M(0.16), R, (R() - 0.5) * 0.6);

  desaturate(g, 0.35);
  grain(g, 0.14);
  return c;
}

function window_(g, x, y, w, h, state, R, trim, ppm) {
  const glass = () => {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#59616a'); gr.addColorStop(0.45, '#2b3036'); gr.addColorStop(1, '#16181b');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  };
  const frame = (col) => {
    const fw = Math.max(2, ppm * 0.06);
    g.fillStyle = col;
    g.fillRect(x, y, w, fw); g.fillRect(x, y + h - fw, w, fw); g.fillRect(x, y, fw, h); g.fillRect(x + w - fw, y, fw, h);
    g.fillRect(x + w / 2 - fw / 2, y + h * 0.27, fw, h * 0.73);   // casement split
    g.fillRect(x, y + h * 0.27, w, fw);                             // transom
    g.fillRect(x, y + h * 0.63, w, fw * 0.7);
  };
  const fcol = rgbStr(170 + R() * 30, 165 + R() * 25, 150 + R() * 20);
  if (state === 'glass') {
    glass();
    if (R() < 0.3) { g.fillStyle = 'rgba(120,110,95,0.6)'; g.fillRect(x + w * 0.1, y + h * 0.3, w * 0.35, h * 0.68); } // curtain
    frame(fcol);
    if (R() < 0.5) for (let k = 0; k < 3; k++) crack(g, x + R() * w, y + R() * h, ppm * 0.4, R, 'rgba(200,205,210,0.5)', 0.8, R() * 6);
  } else if (state === 'dark') {
    g.fillStyle = '#0d0e0f'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(60,55,50,0.5)'; g.fillRect(x + w * 0.55, y + h * 0.1, w * 0.4, h * 0.9);
    frame(fcol);
  } else if (state === 'broken') {
    interior(g, x, y, w, h, R, ppm * 0.3);
    // Panes as split by the frame: transom, then two rows of casement panes.
    const panes = [[x, y, w, h * 0.27]];
    for (const [t0, t1] of [[0.27, 0.63], [0.63, 1]]) { panes.push([x, y + h * t0, w / 2, h * (t1 - t0)]); panes.push([x + w / 2, y + h * t0, w / 2, h * (t1 - t0)]); }
    const lost = R() * 0.5 + 0.3;
    for (const p of panes) { const r = R(); brokenPane(g, ...p, R, r < lost ? 'gone' : r < lost + 0.25 ? 'hole' : r < 0.95 ? 'cracked' : 'intact', ppm); }
    frame(rgbStr(...mix([150, 142, 128], [70, 64, 58], R() * 0.6)));
  } else if (state === 'boarded') {
    g.fillStyle = '#0b0b0b'; g.fillRect(x, y, w, h);
    frame(fcol);
    for (let k = 0; k < 4; k++) {
      g.save();
      const by = y + h * (0.12 + k * 0.24), a = (R() - 0.5) * 0.35;
      g.translate(x + w / 2, by); g.rotate(a);
      const pw = w * 1.25, ph = ppm * 0.2;
      g.fillStyle = rgbStr(95 + R() * 30, 78 + R() * 20, 55 + R() * 15);
      g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.fillStyle = 'rgba(30,22,15,0.5)';
      for (let l = 0; l < 3; l++) g.fillRect(-pw / 2, -ph / 2 + R() * ph, pw, 1);
      g.fillStyle = '#222'; g.fillRect(-pw / 2 + 3, -1, 2, 2); g.fillRect(pw / 2 - 5, -1, 2, 2);
      g.restore();
    }
  } else { // shutters
    glass();
    const col = SHUTTER[(R() * SHUTTER.length) | 0];
    const open = R() < 0.5;
    const sw = w / 2;
    for (const s of [0, 1]) {
      const sx = open ? (s ? x + w + ppm * 0.16 : x - sw - ppm * 0.16) : x + s * sw;
      if (open && R() < 0.3) continue; // fallen off
      g.fillStyle = shade(col, 0.9 + R() * 0.2); g.fillRect(sx, y, sw, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let ly = y + 4; ly < y + h - 3; ly += 4) g.fillRect(sx + 2, ly, sw - 4, 1.5);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.strokeRect(sx + 0.5, y + 0.5, sw - 1, h - 1);
      // Peeling paint.
      g.fillStyle = 'rgba(150,140,120,0.5)';
      for (let k = 0; k < 4; k++) { blobPath(g, sx + R() * sw, y + R() * h, 3 + R() * 4, 2 + R() * 4, R, 7, 0.7); g.fill(); }
    }
  }
}

function ground(g, cx, M, Y, R, base, trim, b, bays, ppm) {
  const roll = R();
  const type = roll < 0.32 ? 'shutter' : roll < 0.58 ? 'shopBroken' : roll < 0.82 ? 'door' : 'barred';
  if (type === 'shutter' || type === 'shopBroken') {
    const w = M(2.4), h = M(2.9), x = cx - w / 2, y = Y(0.6 + 2.9);
    // Sign band with faded lettering.
    if (R() < 0.8) {
      g.fillStyle = 'rgba(30,30,28,0.55)'; g.fillRect(x, Y(4.15), w, M(0.5));
      g.save(); g.globalAlpha = 0.55 + R() * 0.25;
      g.fillStyle = rgbStr(190, 175, 140); g.font = `700 ${M(0.32)}px "DejaVu Serif", Georgia, serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const word = SHOPS[(R() * SHOPS.length) | 0];
      g.fillText(word, cx, Y(3.9), w * 0.92);
      g.restore();
    }
    if (type === 'shutter') {
      const up = R() < 0.3 ? R() * 0.5 : 0;  // jammed half-open
      g.fillStyle = '#060606'; g.fillRect(x, y, w, h);
      const sh = h * (1 - up);
      g.fillStyle = rgbStr(108 + R() * 20, 108 + R() * 15, 104 + R() * 10); g.fillRect(x, y, w, sh);
      for (let ly = y; ly < y + sh; ly += M(0.09)) {
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, ly, w, 1.5);
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, ly + 2, w, 1);
      }
      g.save(); g.beginPath(); g.rect(x, y, w, sh); g.clip();
      for (let k = 0; k < 10; k++) stain(g, x + R() * w, y + R() * sh, M(0.2 + R() * 0.4), 'rgba(105,55,25,1)', 0.5);
      streaks(g, x + w / 2, y, w, sh, R, 12, 0.35, '70,40,20');
      if (R() < 0.7) {
        const wd = ['MRTVÍ', 'POMOC', 'NEJSOU TU', '✕', 'ZDE NIC', 'VYKRADENO'][(R() * 6) | 0];
        spray(g, wd, x + M(0.15), y + sh * (0.45 + R() * 0.3), M(0.38), SPRAY_COLS[(R() * 4) | 0], R, (R() - 0.5) * 0.15);
      }
      g.restore();
      // Lock bar at bottom.
      g.fillStyle = '#3a3836'; g.fillRect(x, y + sh - M(0.1), w, M(0.1));
    } else {
      const kick = M(0.4), fw = M(0.08), gh = h - kick, tr = R() < 0.6 ? M(0.5) : 0;
      interior(g, x, y, w, gh, R, M(0.35), true);
      // Panes: optional transom strip, then left/right of the mullion.
      const panes = [];
      if (tr) panes.push([x, y, w / 2, tr], [x + w / 2, y, w / 2, tr]);
      panes.push([x, y + tr, w / 2, gh - tr], [x + w / 2, y + tr, w / 2, gh - tr]);
      const modes = ['gone', 'hole', 'cracked', 'gone', 'hole', 'intact'];
      let anyBroken = false;
      panes.forEach((p, i) => {
        let m = modes[(R() * modes.length) | 0];
        if (i === panes.length - 1 && !anyBroken) m = R() < 0.5 ? 'gone' : 'hole';
        if (m === 'gone' || m === 'hole') anyBroken = true;
        brokenPane(g, ...p, R, m, ppm);
      });
      // Frame, mullion, transom bar, kick plate.
      g.fillStyle = rgbStr(...mix([43, 38, 34], [80, 74, 66], R()));
      g.fillRect(x, y, w, fw); g.fillRect(x, y, fw, h); g.fillRect(x + w - fw, y, fw, h); g.fillRect(cx - fw / 2, y, fw, gh);
      if (tr) g.fillRect(x, y + tr - fw / 2, w, fw);
      g.fillRect(x, y + gh, w, kick);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + gh, w, 2);
      // Glass crunched on the kick plate.
      for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(${120 + R() * 60},${130 + R() * 60},${140 + R() * 50},${0.25 + R() * 0.35})`; g.fillRect(x + R() * w, y + gh + R() * kick * 0.4, 1 + R() * 2, 1); }
    }
    // Pilaster surrounds.
    g.fillStyle = shade(trim, 0.85);
    g.fillRect(x - M(0.2), Y(4.2), M(0.2), M(3.6)); g.fillRect(x + w, Y(4.2), M(0.2), M(3.6));
  } else if (type === 'door') {
    const w = M(1.5), h = M(2.9), x = cx - w / 2, y = Y(0.15 + 2.9);
    // Stone portal with round arch.
    g.fillStyle = rgbStr(...mix(trim, [120, 115, 105], 0.4));
    g.beginPath(); g.moveTo(x - M(0.3), Y(0)); g.lineTo(x - M(0.3), y + w / 2); g.arc(cx, y + w / 2, w / 2 + M(0.3), Math.PI, 0); g.lineTo(x + w + M(0.3), Y(0)); g.fill();
    g.fillStyle = '#2a1e16';
    g.beginPath(); g.moveTo(x, Y(0)); g.lineTo(x, y + w / 2); g.arc(cx, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, Y(0)); g.fill();
    // Panelled leaves.
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, y + w / 2 - M(0.7)); g.lineTo(cx, Y(0)); g.stroke();
    for (const s of [-1, 1]) {
      g.strokeRect(cx + s * M(0.1) - (s < 0 ? M(0.55) : 0), y + w / 2, M(0.55), M(0.9));
      g.strokeRect(cx + s * M(0.1) - (s < 0 ? M(0.55) : 0), y + w / 2 + M(1.1), M(0.55), M(0.9));
    }
    g.save(); g.beginPath(); g.rect(x, y, w, h + M(0.2)); g.clip();
    for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(${60 + R() * 30},${45 + R() * 20},30,0.35)`; g.fillRect(x + R() * w, y, 1 + R() * 2, h + M(0.3)); }
    g.restore();
    // Spray X search mark.
    const col = R() < 0.6 ? 'rgba(160,30,20,1)' : 'rgba(225,220,205,1)', s = M(0.45), mx = cx - s / 2, my = Y(1.5);
    sprayLine(g, [[mx, my], [mx + s, my + s]], 3.5, col, R);
    sprayLine(g, [[mx + s, my], [mx, my + s]], 3.5, col, R);
    g.save(); g.font = `900 ${M(0.14)}px sans-serif`; g.fillStyle = col; g.globalAlpha = 0.85;
    g.fillText(`${(R() * 5) | 0}`, mx + s * 0.38, my + s * 0.28);
    g.fillText(`${1 + (R() * 28) | 0}.9`, mx - s * 0.3, my + s * 0.6);
    g.fillText(`${(R() * 4) | 0}`, mx + s * 0.38, my + s * 1.0);
    g.restore();
  } else {
    const w = M(1.2), h = M(1.7), x = cx - w / 2, y = Y(1.3 + 1.7);
    window_(g, x, y, w, h, R() < 0.5 ? 'broken' : 'dark', R, trim, ppm);
    g.fillStyle = '#1d1b1a';
    for (let k = 1; k < 6; k++) g.fillRect(x + (w * k) / 6 - 1.5, y - 3, 3, h + 6);
    g.fillRect(x - 3, y + h * 0.5, w + 6, 3);
    streaks(g, cx, y + h, w, M(1.0), R, 8, 0.4, '60,32,18');
  }
}

// Dark room behind a window: near-black with a few faint shapes (furniture, shelving, a doorway).
function interior(g, x, y, w, h, R, depth, shop = false) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#050505'); gr.addColorStop(1, shop ? '#121110' : '#0b0b0b');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const n = shop ? 3 + (R() * 3 | 0) : 1 + (R() * 2 | 0);
  for (let k = 0; k < n; k++) {
    const bw = w * (0.15 + R() * 0.35), bh = h * (0.15 + R() * 0.45), bx = x + R() * (w - bw), by = y + h - bh * (0.6 + R() * 0.4);
    g.fillStyle = `rgba(${30 + R() * 22},${28 + R() * 20},${25 + R() * 16},${0.6 + R() * 0.3})`;
    g.save(); g.translate(bx + bw / 2, by + bh / 2); g.rotate((R() - 0.5) * (shop ? 0.6 : 0.15)); g.fillRect(-bw / 2, -bh / 2, bw, bh); g.restore();
  }
  if (R() < 0.4) { g.fillStyle = 'rgba(38,36,34,0.55)'; g.fillRect(x + w * (0.1 + R() * 0.6), y + h * 0.15, w * 0.25, h * 0.85); } // doorway glow
  g.restore();
}

// Dirty glass fill + reflection, clipped by the current path (supports evenodd holes).
function glassFill(g, x, y, w, h, R, rule = 'nonzero') {
  g.save(); g.clip(rule);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, 'rgba(96,104,112,0.88)'); gr.addColorStop(0.5, 'rgba(52,58,64,0.82)'); gr.addColorStop(1, 'rgba(30,32,34,0.85)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  // Sky reflection: a soft diagonal band at a random offset.
  const o = R(), rg = g.createLinearGradient(x, y, x + w, y + h);
  rg.addColorStop(Math.max(0, o - 0.25), 'rgba(170,180,190,0)'); rg.addColorStop(o, `rgba(170,180,190,${0.12 + R() * 0.15})`); rg.addColorStop(Math.min(1, o + 0.12), 'rgba(170,180,190,0)');
  g.fillStyle = rg; g.fillRect(x, y, w, h);
  // Grime: lower film and a couple of smears.
  const dg = g.createLinearGradient(0, y + h * 0.4, 0, y + h);
  dg.addColorStop(0, 'rgba(70,62,48,0)'); dg.addColorStop(1, 'rgba(70,62,48,0.45)');
  g.fillStyle = dg; g.fillRect(x, y, w, h);
  for (let k = 0; k < 2; k++) { g.fillStyle = 'rgba(80,72,58,0.25)'; blobPath(g, x + R() * w, y + R() * h, w * (0.15 + R() * 0.2), h * (0.1 + R() * 0.15), R, 9, 0.7); g.fill(); }
  g.restore();
}

// Radial cracks + broken rings from an impact point, clipped to the pane.
function impact(g, x, y, w, h, ix, iy, R, holeR = 0) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const n = 6 + (R() * 6 | 0), L = Math.hypot(w, h), rays = [];
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5, px = ix + Math.cos(a) * holeR, py = iy + Math.sin(a) * holeR;
    const pts = [[px, py]], len = L * (0.3 + R() * 0.8), step = Math.max(2, L / 12);
    for (let s = 0; s < len; s += step) { a += (R() - 0.5) * 0.35; px += Math.cos(a) * step; py += Math.sin(a) * step; pts.push([px, py]); }
    rays.push(pts);
  }
  const line = (pts, col, lw, dx = 0) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); pts.forEach(([a, b], k) => k ? g.lineTo(a + dx, b + dx) : g.moveTo(a + dx, b + dx)); g.stroke(); };
  for (const r of rays) { line(r, 'rgba(10,10,10,0.5)', 1, 0.7); line(r, 'rgba(205,212,218,0.55)', 0.8); }
  // Concentric ring fragments joining neighbouring rays.
  for (const ring of [2, 4]) for (let i = 0; i < n; i++) {
    if (R() < 0.45) continue;
    const a = rays[i][Math.min(ring, rays[i].length - 1)], b = rays[(i + 1) % n][Math.min(ring, rays[(i + 1) % n].length - 1)];
    line([a, [(a[0] + b[0]) / 2 + (R() - 0.5) * 3, (a[1] + b[1]) / 2 + (R() - 0.5) * 3], b], 'rgba(200,206,212,0.45)', 0.7);
  }
  g.restore();
}

// Jagged remnant line along one edge of a pane: irregular steps and depths, occasional long spike.
function jagged(x0, y0, x1, y1, nx, ny, depth, R) {
  const pts = [[x0, y0]], len = Math.hypot(x1 - x0, y1 - y0);
  let t = 0;
  while (t < 1) {
    t = Math.min(1, t + (0.05 + R() * 0.22) * Math.min(1, 40 / len + 0.3));
    const d = R() < 0.18 ? depth * (0.7 + R() * 0.6) : R() < 0.3 ? 0 : depth * R() * R() * 0.8;
    pts.push([x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d]);
  }
  pts.push([x1, y1]);
  return pts;
}

// One pane of a broken window. mode: 'gone' (shards in the frame), 'hole' (impact hole + cracks),
// 'cracked' (impact cracks only), 'intact' (dirty glass).
function brokenPane(g, x, y, w, h, R, mode, ppm) {
  if (mode === 'gone') {
    // Remnants: some edges keep shards; the top edge hangs longest.
    const edges = [
      [x, y, x + w, y, 0, 1, h * 0.45], [x + w, y, x + w, y + h, -1, 0, w * 0.3],
      [x + w, y + h, x, y + h, 0, -1, h * 0.2], [x, y + h, x, y, 1, 0, w * 0.3],
    ];
    for (const [x0, y0, x1, y1, nx, ny, d] of edges) {
      if (R() < (ny === 1 ? 0.25 : 0.45)) continue;
      const pts = jagged(x0, y0, x1, y1, nx, ny, d * (0.4 + R() * 0.6), R);
      g.beginPath(); pts.forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.closePath();
      glassFill(g, x, y, w, h, R);
      g.strokeStyle = 'rgba(190,198,205,0.45)'; g.lineWidth = 0.8;
      g.beginPath(); pts.slice(1, -1).forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.stroke();
    }
    return;
  }
  const ix = x + w * (0.2 + R() * 0.6), iy = y + h * (0.2 + R() * 0.6);
  g.beginPath(); g.rect(x, y, w, h);
  if (mode === 'hole') {
    // Jagged hole polygon around the impact point (drawn reversed so evenodd cuts it out).
    const n = 9 + (R() * 6 | 0), rx = w * (0.18 + R() * 0.3), ry = h * (0.15 + R() * 0.3), hp = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = R() < 0.3 ? 0.35 + R() * 0.3 : 0.75 + R() * 0.5;
      hp.push([Math.min(x + w, Math.max(x, ix + Math.cos(a) * rx * k)), Math.min(y + h, Math.max(y, iy + Math.sin(a) * ry * k))]);
    }
    hp.forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.closePath();
    glassFill(g, x, y, w, h, R, 'evenodd');
    g.strokeStyle = 'rgba(195,202,210,0.5)'; g.lineWidth = 0.8;
    g.beginPath(); hp.forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.closePath(); g.stroke();
    impact(g, x, y, w, h, ix, iy, R, Math.min(rx, ry) * 0.6);
  } else {
    glassFill(g, x, y, w, h, R);
    if (mode === 'cracked') impact(g, x, y, w, h, ix, iy, R);
  }
}
