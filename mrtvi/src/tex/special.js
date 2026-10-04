// Posters, pharmacy sign, astronomical clock dial, rotten skin, dirty cloth.
import { rng } from '../layout.js';
import {
  canvas, noiseTile, noiseMask, blendTile, grain, desaturate, rgbStr, shade, mix,
  blobPath, stain, crack, streaks, wrapDraw, splatter, bloodHand,
} from './paint.js';

const POSTERS = [
  { head: 'EVAKUACE', lines: ['Obyvatelé Prahy 1 se dostaví', 'na Pražský hrad.', 'Berte jen nejnutnější.', '', 'EVACUATION — report to the Castle'], col: '#a8261c' },
  { head: 'NEVYCHÁZEJTE', lines: ['Zákaz vycházení od 18:00.', 'Zamkněte dveře. Zhasněte světla.', 'Nedělejte hluk.', '', 'DO NOT GO OUT'], col: '#1f1f1f' },
  { head: 'KARANTÉNA', lines: ['Oblast Starého Města', 'je uzavřena.', 'Pokousaní se musí nahlásit.', '', 'QUARANTINE ZONE'], col: '#c27a12' },
  { head: 'HLEDÁ SE', lines: ['Jana N., 9 let', 'naposledy u Karlova mostu', 'prosím pomozte', '', 'MISSING'], col: '#1f1f1f', photo: true },
  { head: 'POZOR', lines: ['Mrtví reagují na zvuk.', 'Nestřílejte ve městě.', 'Hlava je jediný cíl.', '', 'THEY HEAR YOU'], col: '#a8261c' },
  { head: 'KRIZOVÝ ŠTÁB', lines: ['Výdej vody a léků', 'II. nádvoří Hradu', 'denně 8:00–10:00', '', 'Crisis staff — water & medicine'], col: '#24456e' },
];

export function poster(i) {
  const p = POSTERS[((i % POSTERS.length) + POSTERS.length) % POSTERS.length];
  const R = rng(1300 + i * 17);
  const W = 256, Hh = 362, c = canvas(W, Hh), g = c.getContext('2d');
  g.fillStyle = '#d6d0bd'; g.fillRect(0, 0, W, Hh);
  blendTile(g, noiseTile(161, 256, 4), 'overlay', 0.35, 1);
  g.fillStyle = p.col; g.fillRect(0, 0, W, 64);
  g.fillStyle = '#efe9d8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${p.head.length > 9 ? 30 : 40}px "Arial Black", Impact, "DejaVu Sans", sans-serif`;
  g.fillText(p.head, W / 2, 34, W - 16);
  let y = 92;
  if (p.photo) {
    g.fillStyle = '#5a5650'; g.fillRect(W / 2 - 45, 76, 90, 110);
    g.fillStyle = '#2c2a26'; g.beginPath(); g.ellipse(W / 2, 118, 22, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(W / 2 - 35, 150, 70, 36);
    y = 206;
  }
  g.fillStyle = '#1d1c1a';
  g.font = '700 17px "DejaVu Sans", Arial, sans-serif';
  for (const l of p.lines) { if (l) g.fillText(l, W / 2, y, W - 20); y += l ? 24 : 12; }
  g.font = '11px "DejaVu Sans", Arial, sans-serif';
  g.fillStyle = '#4a4740';
  g.fillText('Magistrát hl. m. Prahy · Krizový štáb', W / 2, Hh - 16, W - 20);
  // Water damage, sun fade, dirt, blood smear.
  blendTile(g, noiseMask(163 + (i % 3), [120, 100, 60], 0.5, 0.8, 256, 4), 'multiply', 0.55, 1);
  for (let k = 0; k < 6; k++) streaks(g, R() * W, R() * Hh * 0.5, 30, 200, R, 3, 0.3, '80,70,40');
  if (R() < 0.4) bloodHand(g, 40 + R() * 170, 200 + R() * 80, 26, R, (R() - 0.5));
  for (let k = 0; k < 3; k++) crack(g, R() * W, R() * Hh, 60, R, 'rgba(60,55,45,0.4)', 1);
  // Torn corner / edges via alpha.
  g.save(); g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  const corner = (R() * 4) | 0, cx = corner & 1 ? W : 0, cy = corner & 2 ? Hh : 0;
  g.moveTo(cx, cy);
  g.lineTo(cx + (cx ? -1 : 1) * (40 + R() * 70), cy);
  for (let k = 0; k < 6; k++) g.lineTo(cx + (cx ? -1 : 1) * (40 - k * 6) * R() * 1.5, cy + (cy ? -1 : 1) * k * 15);
  g.lineTo(cx, cy + (cy ? -1 : 1) * (60 + R() * 60));
  g.closePath(); g.fill();
  for (let x = 0; x < W; x += 3) { g.fillRect(x, 0, 3, R() * 3); g.fillRect(x, Hh - R() * 3, 3, 3); }
  g.restore();
  desaturate(g, 0.3);
  grain(g, 0.12);
  return c;
}

export function signLekarna() {
  const W = 512, Hh = 128, c = canvas(W, Hh), g = c.getContext('2d'), R = rng(1400);
  g.fillStyle = '#1c2b22'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#2f5a3e'; g.fillRect(6, 6, W - 12, Hh - 12);
  blendTile(g, noiseTile(171, 256, 4), 'overlay', 0.4, 1);
  // Green cross in a white box.
  g.fillStyle = '#d8d6cc'; g.fillRect(14, 14, 100, 100);
  g.fillStyle = '#2f8a4a';
  g.fillRect(14 + 34, 22, 32, 84); g.fillRect(22, 14 + 34, 84, 32);
  g.fillStyle = '#e2ddcc'; g.font = '900 70px "DejaVu Sans", "Arial Black", sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('LÉKÁRNA', 134, 68, W - 150);
  // Rust bleed from screws, grime, a bullet hole and smashed corner.
  for (const [x, y] of [[10, 10], [W - 10, 10], [10, Hh - 10], [W - 10, Hh - 10]]) { g.fillStyle = '#3a3026'; g.fillRect(x - 3, y - 3, 6, 6); streaks(g, x, y + 3, 6, 50, R, 3, 0.6, '90,45,15'); }
  blendTile(g, noiseMask(173, [50, 45, 35], 0.5, 0.8, 256, 4), 'source-over', 0.55, 1);
  g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(380, 40, 5, 0, Math.PI * 2); g.fill();
  crack(g, 380, 40, 60, R, 'rgba(20,20,20,0.8)', 1, 0.5);
  crack(g, 380, 40, 40, R, 'rgba(20,20,20,0.8)', 1, 2.5);
  desaturate(g, 0.3);
  grain(g, 0.14);
  return c;
}

// The Old Town astronomical clock dial (Orloj). Opaque: dark stone surround in the corners.
export function clockFace() {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d'), R = rng(1500);
  const cx = S / 2, cy = S / 2, RO = S * 0.47;
  const gold = '#b8923e', goldD = '#7a5e26';
  // Stone surround.
  g.fillStyle = '#2b2722'; g.fillRect(0, 0, S, S);
  blendTile(g, noiseTile(181, 256, 4), 'overlay', 0.6, 2);
  for (const [x, y] of [[70, 70], [S - 70, 70], [70, S - 70], [S - 70, S - 70]]) {
    g.save(); g.translate(x, y);
    g.fillStyle = goldD; g.strokeStyle = '#1a1714'; g.lineWidth = 2;
    for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.ellipse(0, -18, 11, 18, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.fillStyle = gold; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // Outer ring: black with gold Schwabacher-ish 1–24 (Old Czech time).
  g.fillStyle = '#121212'; g.beginPath(); g.arc(cx, cy, RO, 0, Math.PI * 2); g.fill();
  g.strokeStyle = gold; g.lineWidth = 5; g.stroke();
  g.fillStyle = gold; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic 700 34px "DejaVu Serif", Georgia, serif';
  for (let h = 1; h <= 24; h++) {
    const a = -Math.PI / 2 + (h / 24) * Math.PI * 2 + 0.6;
    g.save(); g.translate(cx + Math.cos(a) * RO * 0.93, cy + Math.sin(a) * RO * 0.93); g.rotate(a + Math.PI / 2);
    g.fillText(String(h), 0, 0); g.restore();
  }
  // Main dial: blue sky above the horizon, red-brown dawn/dusk bands, black night below.
  const RD = RO * 0.86;
  g.save(); g.beginPath(); g.arc(cx, cy, RD, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#26507a'; g.fillRect(0, 0, S, S);
  const sky = g.createRadialGradient(cx, cy - RD * 0.3, 0, cx, cy, RD); sky.addColorStop(0, '#3a6a95'); sky.addColorStop(1, '#1c3c5c');
  g.fillStyle = sky; g.fillRect(0, 0, S, S);
  g.fillStyle = '#6a3a22'; g.beginPath(); g.arc(cx, cy + RD * 1.02, RD * 1.22, 0, Math.PI * 2); g.fill();     // aurora/crepusculum
  g.fillStyle = '#0d0c0b'; g.beginPath(); g.arc(cx, cy + RD * 1.12, RD * 1.04, 0, Math.PI * 2); g.fill();     // night (earth)
  // Gold unequal-hour arcs.
  g.strokeStyle = goldD; g.lineWidth = 3;
  for (let k = 1; k <= 12; k++) {
    g.beginPath(); g.arc(cx + (k - 6.5) * RD * 0.16, cy - RD * 1.05, RD * 1.15, 0.35 * Math.PI, 0.65 * Math.PI); g.stroke();
  }
  g.restore();
  // Roman numerals I–XII twice on a gold ring.
  const RN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.strokeStyle = gold; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, RD, 0, Math.PI * 2); g.stroke();
  g.fillStyle = gold; g.font = '700 30px "DejaVu Serif", Georgia, serif';
  for (let h = 0; h < 24; h++) {
    const a = -Math.PI / 2 + (h / 24) * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * RD * 0.9, cy + Math.sin(a) * RD * 0.9); g.rotate(a + Math.PI / 2);
    g.fillText(RN[h % 12], 0, 0); g.restore();
  }
  // Zodiac ring: eccentric, gold-rimmed, 12 houses with marks.
  const zx = cx, zy = cy - RD * 0.22, RZ = RD * 0.6;
  g.lineWidth = 26; g.strokeStyle = 'rgba(24,26,30,0.92)'; g.beginPath(); g.arc(zx, zy, RZ, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.strokeStyle = gold;
  g.beginPath(); g.arc(zx, zy, RZ + 13, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(zx, zy, RZ - 13, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(zx + Math.cos(a) * (RZ - 13), zy + Math.sin(a) * (RZ - 13)); g.lineTo(zx + Math.cos(a) * (RZ + 13), zy + Math.sin(a) * (RZ + 13)); g.stroke();
    const am = a + Math.PI / 12;
    g.save(); g.translate(zx + Math.cos(am) * RZ, zy + Math.sin(am) * RZ); g.rotate(am + Math.PI / 2);
    g.fillStyle = gold; g.font = '700 16px "DejaVu Serif", serif';
    g.fillText(['ARI', 'TAU', 'GEM', 'CNC', 'LEO', 'VIR', 'LIB', 'SCO', 'SGR', 'CAP', 'AQR', 'PSC'][k], 0, 0);
    g.restore();
  }
  // Tropic/equator circles and the central Earth.
  g.lineWidth = 2; g.strokeStyle = goldD;
  for (const r of [0.28, 0.5, 0.72]) { g.beginPath(); g.arc(cx, cy, RD * r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#1b2e44'; g.beginPath(); g.arc(cx, cy, RD * 0.08, 0, Math.PI * 2); g.fill(); g.strokeStyle = gold; g.stroke();
  // Hands: sun hand (gold hand + sun), moon hand (half-dark sphere), star.
  const hand = (a, len, w) => {
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.fillStyle = gold; g.strokeStyle = goldD; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w, 0); g.lineTo(0, -len); g.lineTo(w, 0); g.lineTo(0, len * 0.12); g.closePath(); g.fill(); g.stroke();
    g.restore();
  };
  const sa = 2.2, ma = 0.9;
  hand(sa, RD * 0.92, 10);
  const sx = cx + Math.sin(sa) * RD * 0.55, sy = cy - Math.cos(sa) * RD * 0.55;
  g.fillStyle = gold; g.beginPath();
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2, r = k & 1 ? 22 : 36; g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); }
  g.closePath(); g.fill();
  hand(ma, RD * 0.7, 6);
  const mx = cx + Math.sin(ma) * RD * 0.45, my = cy - Math.cos(ma) * RD * 0.45;
  g.fillStyle = '#c8c4b4'; g.beginPath(); g.arc(mx, my, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#151515'; g.beginPath(); g.arc(mx, my, 22, -Math.PI / 2, Math.PI / 2); g.fill();
  g.fillStyle = gold; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
  // Weathering: tarnish, soot, streaks, cracks, a bullet-chipped section.
  g.save(); g.beginPath(); g.arc(cx, cy, RO + 4, 0, Math.PI * 2); g.clip();
  blendTile(g, noiseTile(183, 256, 4), 'overlay', 0.45, 2);
  blendTile(g, noiseMask(185, [25, 22, 18], 0.5, 0.82, 256, 4), 'source-over', 0.6, 4);
  for (let x = 0; x < S; x += 10) if (R() < 0.35) streaks(g, x, cy - RO + R() * RO, 10, 100 + R() * 300, R, 2, 0.4, '15,12,10');
  for (let k = 0; k < 6; k++) crack(g, cx + (R() - 0.5) * RO * 1.5, cy + (R() - 0.5) * RO * 1.5, 100 + R() * 150, R, 'rgba(10,9,8,0.75)', 1.6, R() * 6);
  g.restore();
  desaturate(g, 0.3);
  grain(g, 0.12);
  return c;
}

// Rotten skin: grey-green, veins, bruises, lesions, dried blood. Tileable.
const SKINS = [[122, 130, 108], [140, 138, 118], [104, 112, 100], [132, 120, 104]];
export function skin(i) {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(1600 + i * 31);
  const base = SKINS[((i % 4) + 4) % 4];
  g.fillStyle = rgbStr(...base); g.fillRect(0, 0, S, S);
  blendTile(g, noiseTile(191 + i, 256, 4), 'overlay', 0.6, 1);
  blendTile(g, noiseTile(195, 256, 16, 3), 'soft-light', 0.5, 1);
  // High-frequency mottling: blotchy pores, livor speckle, fine dark flecks.
  blendTile(g, noiseTile(197, 256, 32, 3, 0.6), 'overlay', 0.55, 1, i * 61, i * 37);
  blendTile(g, noiseMask(199, [90, 70, 80], 0.55, 0.8, 256, 32), 'multiply', 0.45, 1, i * 83, i * 29);
  for (let k = 0; k < 900; k++) {
    const x = R() * S, y = R() * S, r = 0.4 + R() * 1.4;
    g.fillStyle = R() < 0.7 ? `rgba(40,30,35,${0.15 + R() * 0.25})` : `rgba(200,195,160,${0.08 + R() * 0.12})`;
    g.fillRect(x, y, r, r);
  }
  // Bruising: purple/yellow blotches.
  for (let k = 0; k < 7; k++) {
    const x = R() * S, y = R() * S, r = 20 + R() * 40;
    const col = R() < 0.6 ? 'rgba(70,40,70,1)' : 'rgba(120,110,50,1)';
    wrapDraw(S, S, x, y, r, (X, Y) => stain(g, X, Y, r, col, 0.55));
  }
  // Veins: branching dark purple-green lines (paths built once, stroked with wrap copies).
  g.save(); g.globalCompositeOperation = 'multiply'; g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const col = R() < 0.5 ? 'rgba(70,50,90,0.38)' : 'rgba(50,70,60,0.38)';
    const lines = [];
    const vein = (x, y, a, len, w) => {
      const pts = [[x, y]];
      for (let s = 0; s < len; s += 3) {
        a += (R() - 0.5) * 0.7; x += Math.cos(a) * 3; y += Math.sin(a) * 3; pts.push([x, y]);
        if (R() < 0.05 && w > 0.6) vein(x, y, a + (R() - 0.5) * 2, len * 0.5, w * 0.6);
      }
      lines.push([pts, w]);
    };
    vein(R() * S, R() * S, R() * 6.3, 60 + R() * 60, 1.3);
    g.strokeStyle = col;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) for (const [pts, w] of lines) {
      g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], j) => (j ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.stroke();
    }
  }
  g.restore();
  // Lesions: dark wet sores with pale rims.
  for (let k = 0; k < 5; k++) {
    const x = 10 + R() * (S - 20), y = 10 + R() * (S - 20), r = 3 + R() * 8;
    stain(g, x, y, r * 2.2, 'rgba(90,40,50,1)', 0.45);
    g.fillStyle = 'rgba(55,18,14,0.75)'; blobPath(g, x, y, r, r * 0.8, R, 12, 0.7); g.fill();
    g.fillStyle = 'rgba(160,150,90,0.3)'; blobPath(g, x - r * 0.2, y - r * 0.2, r * 0.4, r * 0.3, R, 8, 0.6); g.fill();
  }
  // Dried blood dribbles.
  for (let k = 0; k < 3; k++) { const x = R() * S, y = R() * S * 0.6; streaks(g, x, y, 20, 100, R, 5, 0.85, '60,10,8'); splatter(g, x, y, 25, R, 15, [70, 12, 10]); }
  desaturate(g, 0.2);
  grain(g, 0.12);
  return c;
}

// Dirty everyday clothing patches: 0 jeans, 1 jacket, 2 check shirt, 3 hi-vis, 4 scrubs, 5 suit.
export function cloth(i) {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(1700 + i * 37);
  const kind = ((i % 6) + 6) % 6;
  if (kind === 0) {
    g.fillStyle = '#3c4a62'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(200,210,230,0.18)'; g.lineWidth = 1;
    for (let k = -S; k < S * 2; k += 3) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke(); }
    blendTile(g, noiseTile(201, 256, 4), 'overlay', 0.5, 1);
    for (let k = 0; k < 4; k++) { const x = R() * S, y = R() * S, r = 30 + R() * 30; wrapDraw(S, S, x, y, r, (X, Y) => stain(g, X, Y, r, 'rgba(200,205,215,1)', 0.25, 'screen')); }
  } else if (kind === 1) {
    g.fillStyle = '#4e4a36'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.08 + R() * 0.08})`; g.fillRect(0, y, S, 1); }
    blendTile(g, noiseTile(203, 256, 8), 'overlay', 0.45, 1);
    g.strokeStyle = 'rgba(25,22,15,0.7)'; g.setLineDash([5, 3]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, 64); g.lineTo(S, 64); g.moveTo(0, 192); g.lineTo(S, 192); g.stroke(); g.setLineDash([]);
  } else if (kind === 2) {
    g.fillStyle = '#7e8a96'; g.fillRect(0, 0, S, S);
    const st = 32;
    for (let k = 0; k < S; k += st) {
      g.fillStyle = 'rgba(120,40,40,0.45)'; g.fillRect(k, 0, 10, S); g.fillRect(0, k, S, 10);
      g.fillStyle = 'rgba(30,30,40,0.35)'; g.fillRect(k + 18, 0, 3, S); g.fillRect(0, k + 18, S, 3);
    }
    blendTile(g, noiseTile(205, 256, 8), 'overlay', 0.4, 1);
  } else if (kind === 3) {
    g.fillStyle = '#b3b236'; g.fillRect(0, 0, S, S);
    blendTile(g, noiseTile(207, 256, 4), 'overlay', 0.4, 1);
    for (const y of [70, 170]) {
      g.fillStyle = '#8c8f8c'; g.fillRect(0, y, S, 24);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, y + 3, S, 3);
    }
  } else if (kind === 4) {
    g.fillStyle = '#4f8a8a'; g.fillRect(0, 0, S, S);
    blendTile(g, noiseTile(209, 256, 8), 'overlay', 0.4, 1);
    for (let y = 0; y < S; y += 2) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, y, S, 1); }
  } else {
    g.fillStyle = '#2b2c30'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 16) { g.fillStyle = 'rgba(170,170,170,0.18)'; g.fillRect(x, 0, 1, S); }
    blendTile(g, noiseTile(211, 256, 8), 'overlay', 0.35, 1);
  }
  // Heavy grime: mottled dirt, soot, sweat stains, a darker hem band (stitched hem at the
  // tile seam, so the vertical wrap reads as a hem rather than a seam).
  blendTile(g, noiseMask(213 + kind, [50, 42, 30], 0.42, 0.8, 256, 4), 'multiply', 0.75, 1);
  blendTile(g, noiseMask(219, [30, 26, 20], 0.55, 0.85, 256, 8), 'multiply', 0.55, 1, kind * 71, kind * 43);
  blendTile(g, noiseTile(225, 256, 32, 3), 'overlay', 0.35, 1);
  const hem = g.createLinearGradient(0, S * 0.35, 0, S);
  hem.addColorStop(0, 'rgba(60,48,32,0)'); hem.addColorStop(0.6, 'rgba(60,48,32,0.45)'); hem.addColorStop(1, 'rgba(35,28,20,0.85)');
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = hem; g.fillRect(0, 0, S, S); g.restore();
  g.fillStyle = 'rgba(20,16,12,0.7)'; g.fillRect(0, S - 5, S, 5);
  g.strokeStyle = 'rgba(15,12,10,0.6)'; g.setLineDash([3, 3]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, S - 9); g.lineTo(S, S - 9); g.stroke(); g.setLineDash([]);
  for (let k = 0; k < 3; k++) {   // sweat/water tide marks
    const x = R() * S, y = R() * S, r = 22 + R() * 30;
    wrapDraw(S, S, x, y, r, (X, Y) => {
      stain(g, X, Y, r, 'rgba(120,100,60,1)', 0.35);
      g.strokeStyle = 'rgba(70,55,35,0.35)'; g.lineWidth = 1.5; blobPath(g, X, Y, r * 0.85, r * 0.75, R, 14, 0.4); g.stroke();
    });
  }
  // Dried blood: brown-black crusts, darker centres, drips running down.
  for (let k = 0; k < 2 + kind % 3; k++) {
    const x = R() * S, y = R() * S, r = 22 + R() * 40;
    wrapDraw(S, S, x, y, r, (X, Y) => {
      stain(g, X, Y, r, 'rgba(52,24,16,1)', 0.9);
      g.fillStyle = 'rgba(28,14,10,0.75)'; blobPath(g, X, Y, r * 0.45, r * 0.35, R, 14, 0.7); g.fill();
      splatter(g, X, Y, r * 1.3, R, 18, [40, 18, 12]);
    });
    streaks(g, x, y, r, 40 + R() * 120, R, 4, 0.7, '40,18,12');
  }
  streaks(g, R() * S, 0, 40, S, R, 6, 0.55, '45,22,14');
  // Tears: ragged dark holes with frayed, lighter thread edges and a shadowed rim.
  for (let k = 0; k < 3 + (R() * 3 | 0); k++) {
    const x = 24 + R() * (S - 48), y = 24 + R() * (S - 48), rx = 6 + R() * 16, ry = 3 + R() * 9, rot = R() * Math.PI;
    g.save(); g.translate(x, y); g.rotate(rot);
    stain(g, 0, 0, rx * 1.8, 'rgba(30,24,18,1)', 0.6);
    g.fillStyle = 'rgba(6,5,5,0.97)'; blobPath(g, 0, 0, rx, ry, R, 16, 0.9); g.fill();
    g.strokeStyle = 'rgba(120,108,90,0.3)'; g.lineWidth = 0.8;
    for (let t = 0; t < 9; t++) {
      const a = R() * Math.PI * 2, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry, l = 1.5 + R() * 3;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(a) * l + (R() - 0.5) * 3, ey - Math.sin(a) * l); g.stroke();
    }
    g.restore();
  }
  desaturate(g, kind === 3 ? 0.5 : 0.6);
  grain(g, 0.16);
  return c;
}
