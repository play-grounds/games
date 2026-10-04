// HUD: DOM overlay in #hud. Title, in-play readouts, death and win screens, toasts.
// Reads game.player / game.state defensively; touches the DOM only when a value changes.

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; z-index: 10; color: #e8e2d6;
  font-family: "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif;
  font-stretch: condensed; text-transform: uppercase; letter-spacing: .08em;
  text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,.8); user-select: none;
  font-size: clamp(11px, 1.15vw + .3vh, 17px); }
#hud * { box-sizing: border-box; }
#hud button { pointer-events: auto; }
#hud .grain { position: absolute; inset: -50%; opacity: .07; mix-blend-mode: overlay;
  background-image: var(--noise); background-size: 220px 220px; animation: hudgrain .9s steps(4) infinite; }
@keyframes hudgrain { 0%{transform:translate(0,0)} 25%{transform:translate(-3%,2%)} 50%{transform:translate(2%,-3%)} 75%{transform:translate(-2%,-1%)} }
#hud .layer { position: absolute; inset: 0; display: none; }
#hud .layer.on { display: block; }
#hud small, #hud .en { font-size: .72em; opacity: .7; letter-spacing: .12em; }

/* play */
#hud .obj { position: absolute; left: 2.2vw; top: 2.4vh; max-width: 40vw; line-height: 1.3; }
#hud .obj .cz { font-size: 1.05em; letter-spacing: .14em; }
#hud .obj .cz::before { content: ""; display: inline-block; width: .5em; height: .5em; margin-right: .6em;
  border: 1px solid #e8e2d6; transform: translateY(-.1em) rotate(45deg); }
#hud .clock { position: absolute; right: 2.2vw; top: 2.4vh; font-size: 1.1em; letter-spacing: .2em; opacity: .85;
  font-variant-numeric: tabular-nums; }
#hud .compass { position: absolute; left: 50%; top: 2vh; width: min(46vw, 520px); height: 2.6em; transform: translateX(-50%);
  overflow: hidden; border-bottom: 1px solid rgba(232,226,214,.35);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
#hud .compass .tk { position: absolute; bottom: 0; width: 1px; background: #e8e2d6; opacity: .45; }
#hud .compass .lb { position: absolute; bottom: .45em; transform: translateX(-50%); font-weight: 700; letter-spacing: .05em; }
#hud .compass .lb.m { font-size: .75em; opacity: .6; font-weight: 400; }
#hud .compass .mk { position: absolute; top: 0; transform: translateX(-50%); font-size: .7em; white-space: nowrap; text-align: center; color: #e9c46a; }
#hud .compass .mk i { display: block; margin: 0 auto 1px; width: .55em; height: .55em; background: #e9c46a; transform: rotate(45deg); }
#hud .compass .ctr { position: absolute; left: 50%; bottom: 0; width: 1px; height: .9em; background: #e8e2d6; }
#hud .dist { position: absolute; left: 50%; top: calc(2vh + 3.7em); transform: translateX(-50%); font-size: .75em; opacity: .75;
  font-variant-numeric: tabular-nums; }

#hud .vitals { position: absolute; left: 2.2vw; bottom: 3vh; width: min(24vw, 260px); }
#hud .bar { position: relative; height: 5px; margin-top: .35em; background: rgba(0,0,0,.45);
  border: 1px solid rgba(232,226,214,.25); box-shadow: 0 0 4px rgba(0,0,0,.6); }
#hud .bar b { position: absolute; left: 0; top: 0; bottom: 0; background: #e8e2d6; transition: width .15s linear;
  -webkit-mask-image: var(--worn); mask-image: var(--worn); -webkit-mask-size: 120px 8px; mask-size: 120px 8px; }
#hud .bar.hp b { background: #d8cfbf; }
#hud .bar.hp.low b { background: #a33a2c; }
#hud .bar.st { height: 3px; } #hud .bar.st b { background: #9aa39a; }
#hud .vl { display: flex; justify-content: space-between; font-size: .72em; opacity: .75; margin-top: .55em; }
#hud .noise { display: flex; align-items: center; gap: .5em; margin-top: .7em; font-size: .72em; opacity: .85; }
#hud .noise svg { width: 2.6em; height: 1.8em; overflow: visible; }
#hud .noise path { fill: none; stroke: #e8e2d6; stroke-width: 1.6; transition: opacity .12s, stroke .2s; }
#hud .noise.loud path { stroke: #c9573f; }
#hud .seen { display: flex; align-items: center; gap: .5em; margin-top: .45em; font-size: .72em; min-height: 1.6em; }
#hud .seen .eye { display: none; align-items: center; gap: .5em; }
#hud .seen.on .eye { display: flex; }
#hud .seen .fl { display: none; align-items: center; gap: .3em; opacity: .75; }
#hud .seen .fl.on { display: flex; }
#hud .seen .fl svg { width: 1.9em; height: 1.2em; }
#hud .seen .fl path { stroke: #e8e2d6; fill: none; stroke-width: 1.4; stroke-linecap: round; }
#hud .seen .fl rect { fill: #e8e2d6; }
#hud .seen svg { width: 2.6em; height: 1.5em; overflow: visible; }
#hud .seen path, #hud .seen circle { fill: none; stroke: #e8e2d6; stroke-width: 1.5; stroke-linecap: round; }
#hud .seen.on { opacity: 1; color: #e0a24a; }
#hud .seen.on path, #hud .seen.on circle { stroke: #e0a24a; }
#hud .seen.on circle { fill: #e0a24a; }
#hud .seen.pulse .eye svg { animation: hudeye .5s ease-out 2; }
@keyframes hudeye { 0% { transform: scale(1.6); filter: drop-shadow(0 0 6px #e0a24a); } 100% { transform: scale(1); } }

#hud .weap { position: absolute; right: 2.2vw; bottom: 3vh; text-align: right; }
#hud .weap .wn { font-size: .8em; letter-spacing: .25em; opacity: .75; }
#hud .weap .am { font-size: 2.2em; font-weight: 700; letter-spacing: .05em; font-variant-numeric: tabular-nums; line-height: 1.05; }
#hud .weap .am span { font-size: .5em; opacity: .6; font-weight: 400; }
#hud .weap .am.empty { color: #c9573f; }
#hud .weap .rs { font-size: .85em; letter-spacing: .14em; font-variant-numeric: tabular-nums; opacity: .85; }
#hud .weap .rs b { font-size: 1.35em; letter-spacing: .04em; }
#hud .weap .rs.dry { color: #d0402e; opacity: 1; animation: hudflash .7s steps(2) infinite; }
#hud .weap .am.dry { color: #d0402e; animation: hudflash .7s steps(2) infinite; }
@keyframes hudflash { 50% { opacity: .25; } }

#hud .xh { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
#hud .xh i { position: absolute; width: 3px; height: 3px; margin: -1.5px; background: #e8e2d6; border-radius: 50%;
  box-shadow: 0 0 2px #000; transition: transform .12s ease-out, opacity .12s; opacity: .85; }
#hud .xh i.d { opacity: 0; }
#hud .xh.wide i.d { opacity: .6; }
#hud .xh.wide i.d0 { transform: translate(0,-12px); } #hud .xh.wide i.d1 { transform: translate(12px,0); }
#hud .xh.wide i.d2 { transform: translate(0,12px); }  #hud .xh.wide i.d3 { transform: translate(-12px,0); }

#hud .prompt { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); text-align: center; white-space: nowrap;
  letter-spacing: .14em; display: none; }
#hud .prompt.on { display: block; }
#hud .prompt kbd { display: inline-block; padding: .05em .45em; margin-right: .5em; border: 1px solid #e8e2d6;
  font-family: inherit; font-weight: 700; background: rgba(0,0,0,.35); }

#hud .dmg { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
#hud .dmg i { position: absolute; left: -11vmin; top: -24vmin; width: 22vmin; height: 5vmin; opacity: 0;
  border-top: .9vmin solid rgba(205,35,20,.95); border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  box-shadow: inset 0 .8vmin 1.2vmin -.4vmin rgba(160,20,10,.6); transform-origin: 11vmin 24vmin;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent); }
#hud .hm { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
#hud .hm i { position: absolute; left: -1px; top: -10px; width: 2px; height: 6px; background: #f2ece0; box-shadow: 0 0 2px #000; }
#hud .hm i:nth-child(1) { transform: rotate(45deg) translateY(-3px); transform-origin: 1px 10px; }
#hud .hm i:nth-child(2) { transform: rotate(135deg) translateY(-3px); transform-origin: 1px 10px; }
#hud .hm i:nth-child(3) { transform: rotate(225deg) translateY(-3px); transform-origin: 1px 10px; }
#hud .hm i:nth-child(4) { transform: rotate(315deg) translateY(-3px); transform-origin: 1px 10px; }
#hud .hm.head i { background: #ff3b24; width: 3px; height: 8px; left: -1.5px; top: -12px; transform-origin: 1.5px 12px; box-shadow: 0 0 4px #ff3b24; }
#hud .stl { position: absolute; left: 50%; top: calc(50% + 18px); transform: translateX(-50%); white-space: nowrap;
  font-size: .7em; letter-spacing: .18em; color: #cfd6c4; opacity: 0; transition: opacity .15s; }
#hud .stl.on { opacity: .85; }
#hud .stl small { opacity: .6; }
#hud .seen .dir { display: inline-block; width: 1.2em; height: 1.2em; margin-left: -.2em; transition: transform .08s linear; }
#hud .seen .dir svg { width: 100%; height: 100%; }
#hud .seen .dir path { stroke: #e0a24a; stroke-width: 2; fill: none; }
#hud .tbest { margin-top: 2.4vh; font-size: .82em; letter-spacing: .2em; opacity: .8; font-variant-numeric: tabular-nums; }
#hud .tbest:empty { display: none; }
#hud .vig { position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(110,8,4,.55) 100%); transition: opacity .3s; }

#hud .msgs { position: absolute; left: 50%; top: calc(2vh + 5.6em); transform: translateX(-50%); text-align: center; width: 70vw; }
#hud .msgs div { margin: .25em 0; letter-spacing: .14em; transition: opacity .6s; font-size: .82em; opacity: .9; }

/* pause */
#hud .pausescr { pointer-events: auto; cursor: pointer; background: rgba(5,5,7,.72); }
#hud .pausescr .title { font-size: clamp(48px, 11vw, 160px); }
#hud .sens { margin-top: 3vh; display: flex; align-items: center; gap: 1em; padding: .6em 1.2em; cursor: default;
  border: 1px solid rgba(232,226,214,.3); background: rgba(0,0,0,.35); font-size: .85em; letter-spacing: .14em; }
#hud .sens input { width: min(40vw, 260px); accent-color: #e8e2d6; cursor: pointer; }
#hud .sens output { min-width: 3em; text-align: right; font-variant-numeric: tabular-nums; }
#hud .pausescr .ctl { margin-top: 3vh; }

/* screens */
#hud .scr { background: radial-gradient(ellipse at center, rgba(10,10,12,.55), rgba(5,5,6,.92));
  display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4vh 6vw; }
#hud .scr.on { display: flex; }
#hud .title { font-family: Impact, "Haettenschweiler", "Arial Black", "Franklin Gothic Heavy", sans-serif;
  font-size: clamp(64px, 17vw, 260px); line-height: .9; letter-spacing: .12em; margin-right: -.12em; font-stretch: condensed;
  color: #e8e2d6; text-shadow: 0 0 1px #000, 3px 4px 0 rgba(0,0,0,.65), 0 0 40px rgba(0,0,0,.9);
  -webkit-mask-image: var(--stencil); mask-image: var(--stencil); -webkit-mask-size: 340px 340px; mask-size: 340px 340px; }
#hud .title.red { color: #a8322a; font-size: clamp(48px, 11vw, 170px); }
#hud .sub { margin-top: 1.2vh; font-size: 1.35em; letter-spacing: .35em; }
#hud .sub small { display: block; margin-top: .3em; }
#hud .brief { margin-top: 4.5vh; max-width: 46em; text-transform: none; letter-spacing: .03em; line-height: 1.45; }
#hud .brief p { margin: .15em 0; }
#hud .brief .en { display: block; margin-top: .8em; font-size: .78em; }
#hud .ctl { margin-top: 3.5vh; display: grid; grid-template-columns: auto auto; gap: .2em 1.4em; font-size: .78em; opacity: .8; text-align: left; }
#hud .ctl b { text-align: right; letter-spacing: .1em; }
#hud .go { margin-top: 4.5vh; font-size: 1.15em; letter-spacing: .3em; animation: hudblink 2.4s ease-in-out infinite; }
@keyframes hudblink { 50% { opacity: .35; } }
#hud .stats { margin-top: 3vh; display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2em 2.4em; font-size: .9em; letter-spacing: .2em; }
#hud .stats b { display: block; font-size: 2em; letter-spacing: .05em; }
#hud .btn { margin-top: 4vh; padding: .7em 2.2em; font: inherit; letter-spacing: .3em; text-transform: uppercase; cursor: pointer;
  color: #e8e2d6; background: rgba(0,0,0,.4); border: 1px solid rgba(232,226,214,.7); border-radius: 0;
  text-shadow: inherit; }
#hud .btn:hover { background: rgba(232,226,214,.12); }
`;

const svgURL = (s) => `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}")`;
const NOISE = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.4 -.2'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);
// Stencil wear: mostly opaque with blotchy holes and a few scratches.
const STENCIL = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='340'><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='.045 .09' numOctaves='4' seed='7'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -9 6.3'/></filter><rect width='100%' height='100%' filter='url(#s)'/><g stroke='black' stroke-width='2' opacity='.9'><path d='M0 120 L340 108'/><path d='M40 250 L300 262'/><path d='M120 0 L128 340' stroke-width='1.2'/></g></svg>`);
const WORN = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='8'><filter id='w'><feTurbulence baseFrequency='.2 .9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -5 4.2'/></filter><rect width='100%' height='100%' filter='url(#w)'/></svg>`);

const HTML = `
<div class="layer play">
  <div class="vig"></div>
  <div class="dmg"></div>
  <div class="obj"><div class="cz"></div><div class="en"></div></div>
  <div class="clock"></div>
  <div class="compass"><div class="tape"></div><div class="mk"><i></i></div><div class="ctr"></div></div>
  <div class="dist"></div>
  <div class="hm"><i></i><i></i><i></i><i></i></div>
  <div class="xh"><i></i><i class="d d0"></i><i class="d d1"></i><i class="d d2"></i><i class="d d3"></i></div>
  <div class="stl">Tiše <small>— silent kill</small></div>
  <div class="prompt"><kbd>E</kbd><span></span></div>
  <div class="vitals">
    <div class="vl"><span>Zdraví <small>health</small></span><span class="hpv"></span></div>
    <div class="bar hp"><b></b></div>
    <div class="bar st"><b></b></div>
    <div class="noise"><svg viewBox="0 0 26 18"><rect x="0" y="6" width="3" height="6" fill="#e8e2d6"/>
      <path d="M6 5 Q9 9 6 13"/><path d="M11 2.5 Q16 9 11 15.5"/><path d="M16 0 Q23 9 16 18"/></svg><span class="nl">Ticho</span></div>
    <div class="seen"><span class="eye"><svg viewBox="0 0 26 15"><g class="open"><path d="M1.5 7.5 Q13 -2.5 24.5 7.5 Q13 17.5 1.5 7.5 Z"/><circle cx="13" cy="7.5" r="2.6"/></g></svg><span class="dir"><svg viewBox="0 0 12 12"><path d="M3 7.5 L6 3.5 L9 7.5"/></svg></span><span class="sl">Vidí tě <small>they see you</small></span></span>
      <span class="fl" title="flashlight"><svg viewBox="0 0 22 12"><rect x="0" y="4" width="8" height="4" rx="1"/><path d="M8 3 L11 2 L11 10 L8 9 Z"/><path d="M13 3 L20 0.5"/><path d="M13 6 L21 6"/><path d="M13 9 L20 11.5"/></svg><small>svítilna</small></span></div>
  </div>
  <div class="weap"><div class="wn"></div><div class="am"></div><div class="rs"></div></div>
</div>
<div class="msgs"></div>
<div class="layer scr titlescr">
  <div class="title">MRTVÍ</div>
  <div class="sub">Praha, 47 dní poté<small>Prague, 47 days after</small></div>
  <div class="brief">
    <p>Vyzvedni léky v lékárně na Celetné.</p>
    <p>Přenes je přes Karlův most do tábora na Hradě.</p>
    <p>Orloj pořád odbíjí — a oni na to slyší.</p>
    <span class="en">Get the medicine from the pharmacy on Celetná. Carry it over Charles Bridge to the camp at the Castle. The clock still chimes — and they come to it.</span>
  </div>
  <div class="ctl">
    <b>WASD</b><span>chůze <small>move</small></span>
    <b>Shift / C</b><span>běh / plížení <small>sprint / crouch</small></span>
    <b>Myš · LMB</b><span>rozhled · útok <small>look · attack</small></span>
    <b>1 / 2 · R</b><span>páčidlo / pistole · nabít <small>crowbar / pistol · reload</small></span>
    <b>E · F</b><span>použít · svítilna <small>use · flashlight</small></span>
  </div>
  <div class="tbest"></div>
  <div class="go">Klikni pro začátek <small>— click to begin</small></div>
</div>
<div class="layer scr pausescr">
  <div class="title">PAUZA</div>
  <div class="sub"><small>paused</small></div>
  <div class="ctl">
    <b>WASD</b><span>chůze <small>move</small></span>
    <b>Shift / C</b><span>běh / plížení <small>sprint / crouch</small></span>
    <b>Myš · LMB</b><span>rozhled · útok <small>look · attack</small></span>
    <b>1 / 2 · R</b><span>páčidlo / pistole · nabít <small>crowbar / pistol · reload</small></span>
    <b>E · F</b><span>použít · svítilna <small>use · flashlight</small></span>
  </div>
  <label class="sens">Citlivost myši <small>mouse</small><input type="range" min="0.3" max="2.5" step="0.05" value="1"><output>1.00</output></label>
  <div class="go">Klikni pro pokračování <small>— click to resume</small></div>
</div>
<div class="layer scr deadscr">
  <div class="title red">JSI MRTVÝ</div>
  <div class="sub"><small>You are dead</small></div>
  <div class="stats dstats"></div>
  <button class="btn">Znovu <small>— restart</small></button>
</div>
<div class="layer scr wonscr">
  <div class="title" style="font-size:clamp(40px,8vw,120px)">Léky doručeny</div>
  <div class="sub"><small>The medicine is delivered</small></div>
  <div class="brief">
    <p>Lékař ti beze slova vezme krabici z rukou. U ohně někdo poprvé za týdny usne.</p>
    <p>Dole ve městě orloj odbíjí dál. Zítra půjde někdo jiný.</p>
    <span class="en">The medic takes the box without a word. By the fire someone sleeps for the first time in weeks. Down in the city the clock keeps chiming. Tomorrow someone else goes.</span>
  </div>
  <div class="stats wstats"></div>
  <button class="btn">Znovu <small>— play again</small></button>
</div>
<div class="grain"></div>`;

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU + Math.PI) % TAU - Math.PI;   // -> [-π, π)
const WEAPONS = { crowbar: ['Páčidlo', 'crowbar'], pistol: ['Pistole', 'pistol'] };

export function create(game) {
  const L = game.layout || {};
  let root = document.getElementById('hud');
  if (!root) { root = document.createElement('div'); root.id = 'hud'; document.body.appendChild(root); }
  if (!document.getElementById('hud-css')) {
    const st = document.createElement('style');
    st.id = 'hud-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  root.style.setProperty('--noise', NOISE);
  root.style.setProperty('--stencil', STENCIL);
  root.style.setProperty('--worn', WORN);
  root.innerHTML = HTML;
  const $ = (s) => root.querySelector(s);
  const el = {
    play: $('.play'), title: $('.titlescr'), dead: $('.deadscr'), won: $('.wonscr'),
    objCz: $('.obj .cz'), objEn: $('.obj .en'), clock: $('.clock'),
    tape: $('.compass .tape'), mk: $('.compass .mk'), compass: $('.compass'), dist: $('.dist'),
    xh: $('.xh'), prompt: $('.prompt'), promptT: $('.prompt span'),
    hp: $('.bar.hp b'), hpBar: $('.bar.hp'), hpv: $('.hpv'), st: $('.bar.st b'),
    noise: $('.noise'), arcs: [...root.querySelectorAll('.noise path')], nl: $('.noise .nl'),
    wn: $('.weap .wn'), am: $('.weap .am'), dmg: $('.dmg'), vig: $('.vig'), msgs: $('.msgs'),
    dstats: $('.dstats'), wstats: $('.wstats'),
    pause: $('.pausescr'), sens: $('.sens'), sensIn: $('.sens input'), sensOut: $('.sens output'),
    seen: $('.seen'), stl: $('.stl'), dir: $('.seen .dir'), tbest: $('.tbest'), fl: $('.seen .fl'), rs: $('.weap .rs'), hm: $('.hm'),
  };
  for (const b of root.querySelectorAll('.btn')) b.addEventListener('click', (e) => { e.stopPropagation(); location.reload(); });
  for (const b of root.querySelectorAll('.btn')) b.addEventListener('pointerdown', (e) => e.stopPropagation());

  // Mouse sensitivity (pause screen). The slider swallows its own events so dragging it
  // neither resumes the game (main: pointerdown/keydown) nor grabs pointer lock (player: click).
  const loadNum = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : d; } catch (e) { return d; } };
  const showSens = (v) => { el.sensIn.value = String(v); el.sensOut.textContent = (+v).toFixed(2); };
  const clampSens = (v) => Math.max(0.3, Math.min(2.5, Number.isFinite(+v) && +v > 0 ? +v : 1));
  const readSens = () => clampSens(loadNum('mrtvi.sens', 1));
  {
    // A stored value outside 0.3–2.5 is clamped on read, written back, and pushed to the player.
    const raw = loadNum('mrtvi.sens', null), v = readSens();
    showSens(v);
    if (raw !== null && raw !== v) {
      try { localStorage.setItem('mrtvi.sens', String(v)); } catch (e) { /* ignore */ }
      game.emit?.('settings', { sens: v });
    }
  }
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup']) el.sens.addEventListener(ev, (e) => e.stopPropagation());
  el.sensIn.addEventListener('input', () => {
    const v = clampSens(el.sensIn.value);
    showSens(v);
    try { localStorage.setItem('mrtvi.sens', String(v)); } catch (e) { /* ignore */ }
    game.emit?.('settings', { sens: v });
  });

  // Best time per seed.
  const readBest = () => { try { const o = JSON.parse(localStorage.getItem('mrtvi.best') || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const writeBest = (o) => { try { localStorage.setItem('mrtvi.best', JSON.stringify(o)); } catch (e) { /* ignore */ } };

  // Compass tape: labels/ticks every 15°, laid out once; we just translate the tape.
  // The tape spans -360..+720 degrees so any heading has coverage either side.
  const PXDEG = 3;                                  // pixels per degree (recomputed from width)
  const EN = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let tapeHTML = '';
  for (let d = -360; d <= 720; d += 15) {
    const n = ((d % 360) + 360) % 360;
    const x = (d + 360) * PXDEG;
    if (EN[n] !== undefined) tapeHTML += `<div class="lb${n % 90 ? ' m' : ''}" style="left:${x}px">${EN[n]}</div>`;
    tapeHTML += `<div class="tk" style="left:${x}px;height:${n % 90 ? (n % 45 ? 4 : 7) : 10}px"></div>`;
  }
  el.tape.innerHTML = tapeHTML;
  el.tape.style.position = 'absolute';
  el.tape.style.top = '0'; el.tape.style.bottom = '0';

  // Damage arcs: a small pool reused round-robin.
  const arcs = [];
  for (let i = 0; i < 4; i++) { const a = document.createElement('i'); el.dmg.appendChild(a); arcs.push({ a, t: 0, ang: 0, from: null }); }
  let arcI = 0, vigT = 0, compassW = 0;
  const ARC_T = 0.75;

  // Toasts. A keyed toast replaces the live one with the same key (chimes never stack).
  const toasts = [];
  function message(text, secs = 3, key = null) {
    if (!text) return;
    if (key) for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].key === key) { toasts[i].d.remove(); toasts.splice(i, 1); }
    const d = document.createElement('div');
    d.innerHTML = String(text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      .replace(/ — (.*)$/, ' <small>— $1</small>');
    el.msgs.appendChild(d);
    toasts.push({ d, t: secs, key });
    while (toasts.length > 4) toasts.shift().d.remove();
  }

  // Stats.
  let killed = 0, playT = 0, warnedHour = null, prevHp = null, prevRes = null;
  const P = () => game.player || {};
  const yawOf = () => (Number.isFinite(P().yaw) ? P().yaw : 0);

  game.on?.('deadKilled', () => { killed++; });
  game.on?.('chime', (d) => message(`Orloj odbíjí ${d && Number.isFinite(d.hour) ? (d.hour % 12 || 12) + '× ' : ''}— they are coming`, 5, 'chime'));
  // Bandages and rounds are announced from the health/reserve jumps in update().
  game.on?.('pickup', (d) => {
    const it = String(d?.item ?? '');
    if (/med|lék/i.test(it)) message('Léky v batohu — medicine taken', 4, 'pickup-med');
    else if (/ammo|náboj|round|bandage|obvaz|heal/i.test(it)) return;
    else message(`Sebráno: ${it} — picked up`, 2.5);
  });
  game.on?.('delivered', () => message('Léky doručeny — delivered', 4));
  game.on?.('teleport', (d) => { if (d?.to === 'pharmacy') message('Lékárna — the pharmacy', 2.5); });
  game.on?.('playerHurt', (d) => {
    const p = P();
    vigT = Math.min(1, vigT + 0.35 + (d?.dmg || 0) / 60);
    if (!d?.from || !Number.isFinite(d.from.x) || !p.pos) return;
    // One arc per hit; a repeat hit from the same attacker refreshes its arc instead of stacking.
    let s = arcs.find((a) => a.t > 0 && a.from && Math.hypot(a.from.x - d.from.x, a.from.z - d.from.z) < 1.5);
    if (!s) s = arcs[arcI++ % arcs.length];
    s.from = { x: d.from.x, z: d.from.z };
    s.t = ARC_T;
  });

  // Hit marker: a small X at the crosshair when a shot or swing connects; red for a headshot.
  let hmT = 0, lastHitRef = P().lastHit, lastMarkAt = -1;
  function hitMark(head) {
    const now = performance.now();
    if (now - lastMarkAt < 40) return;          // event + lastHit change for the same hit
    lastMarkAt = now;
    hmT = head ? 0.32 : 0.2;
    el.hm.classList.toggle('head', !!head);
    el.hm.style.opacity = '1';
    try { if (head) (game.audio?.headshot ?? game.audio?.hitMarker)?.call(game.audio); else game.audio?.hitMarker?.(); } catch (e) { /* ignore */ }
  }
  const isHead = (h) => !!(P().lastHitWasHead || h?.head || h?.part === 'head');
  game.on?.('hit', (d) => { lastHitRef = P().lastHit; hitMark(d?.head || d?.part === 'head' || isHead(d)); });

  // Furthest progress along the route (metres of polyline), for the death screen.
  const RP = (L.ROUTE || []).map(([x, z]) => ({ x, z }));
  const RCUM = [0];
  for (let i = 1; i < RP.length; i++) RCUM.push(RCUM[i - 1] + Math.hypot(RP[i].x - RP[i - 1].x, RP[i].z - RP[i - 1].z));
  const RLEN = RCUM[RCUM.length - 1] || 0;
  let maxProg = 0;
  function progressAt(px, pz) {
    let best = Infinity, at = 0;
    for (let i = 0; i < RP.length - 1; i++) {
      const a = RP[i], b = RP[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / l2));
      const d = Math.hypot(a.x + ex * t - px, a.z + ez * t - pz);
      if (d < best) { best = d; at = RCUM[i] + t * Math.sqrt(l2); }
    }
    return best < 30 ? at : null;               // off the route (alleys, interiors): no credit
  }

  // Cached last-written values.
  const last = {};
  const set = (key, v, fn) => { if (last[key] !== v) { last[key] = v; fn(v); } };
  const text = (node) => (v) => { node.textContent = v; };
  const cls = (node, c) => (v) => node.classList.toggle(c, !!v);

  let prevStamina = 1, sprintT = 0;
  const hint = { gun: false, shove: false };
  const fmtT = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function objective() {
    const st = game.state || {};
    if (st.delivered || st.phase === 'won') return { cz: 'Hotovo', en: 'done', to: null };
    if (st.hasMedicine) return { cz: 'Dones léky na Hrad', en: 'take the medicine to the Castle', to: L.MEDIC };
    return { cz: 'Najdi lékárnu na Celetné', en: 'find the pharmacy on Celetná', to: L.PHARMACY_DOOR };
  }

  // With the medicine, steer along the route rather than straight through the blocks:
  // the marker points at the next route point, the distance is what's left of the route.
  const ROUTE = (L.ROUTE || []).map(([x, z]) => ({ x, z }));
  function waypoint(pos, to) {
    if (to !== L.MEDIC || ROUTE.length < 3) return { at: to, dist: Math.hypot(to.x - pos.x, to.z - pos.z) };
    let k = 2, best = Infinity;
    for (let i = 2; i < ROUTE.length; i++) {
      const d = Math.hypot(ROUTE[i].x - pos.x, ROUTE[i].z - pos.z);
      if (d < best) { best = d; k = i; }
    }
    const n = Math.min(k + 1, ROUTE.length - 1), a = ROUTE[k], b = ROUTE[n];
    if (n !== k && (Math.hypot(b.x - pos.x, b.z - pos.z) < Math.hypot(b.x - a.x, b.z - a.z) || best < 6)) k = n;
    let dist = Math.hypot(ROUTE[k].x - pos.x, ROUTE[k].z - pos.z);
    for (let i = k; i < ROUTE.length - 1; i++) dist += Math.hypot(ROUTE[i + 1].x - ROUTE[i].x, ROUTE[i + 1].z - ROUTE[i].z);
    return { at: ROUTE[k], dist };
  }

  // "They see you" means something close is coming: a chaser with line of sight within 25 m.
  // dead.js may expose seeingNear; otherwise check nearby chasers against the colliders.
  const SEE_R = 25;
  // Returns false, or the nearest watcher ({x, z}, or true when its position is unknown).
  function seenNear(p) {
    const D = game.dead;
    if (!D || !(Number(D.seeing) > 0) || !p.pos) return false;
    const list = D.debug?.near?.(p.pos.x, p.pos.z, SEE_R);
    if (Number.isFinite(D.seeingNear) && !(D.seeingNear > 0)) return false;
    if (!list) return Number.isFinite(D.nearest?.(p.pos.x, p.pos.z)) && D.nearest(p.pos.x, p.pos.z) < SEE_R;
    const CH = D.debug?.STATES?.CHASE;
    list.sort((a, b) => a.d - b.d);
    let any = null;
    for (const d of list) {
      if (CH !== undefined && d.st !== CH) continue;
      any = any || d;
      if (CH !== undefined && d.st !== CH) continue;
      const ey = (p.pos.y || 0) + 1.6, dx = p.pos.x - d.x, dz = p.pos.z - d.z, len = Math.hypot(dx, dz);
      if (len < 2) return d;
      // From the player's eye towards the chaser (the dead may stand against a collider).
      const ux = -dx / len, uz = -dz / len;
      const wall = game.collide?.raycast?.({ x: p.pos.x + ux * 0.3, y: ey, z: p.pos.z + uz * 0.3 }, { x: ux, y: 0, z: uz }, len - 1);
      if (!(wall < len - 1)) return d;
    }
    // dead.js trusts its own sight test; point at the nearest chaser if ours disagrees.
    return Number.isFinite(D.seeingNear) ? (any || true) : false;
  }

  function update(dt) {
    dt = Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    const st = game.state || {};
    const phase = st.phase || 'play';
    if (phase === 'play') playT += dt;     // paused time doesn't count

    set('phase', phase, (ph) => {
      el.play.classList.toggle('on', ph === 'play' || ph === 'paused');
      el.title.classList.toggle('on', ph === 'title');
      el.pause.classList.toggle('on', ph === 'paused');
      el.dead.classList.toggle('on', ph === 'dead');
      el.won.classList.toggle('on', ph === 'won');
      el.msgs.style.display = ph === 'play' ? '' : 'none';
      if (ph === 'play') measure();
      if (ph === 'paused') showSens(readSens());
      if (ph === 'title') {
        const b = readBest(), seed = st.seed;
        let k = +b[seed] > 0 ? seed : null;
        if (k === null) for (const s of Object.keys(b)) if (+b[s] > 0 && (k === null || +b[s] < +b[k])) k = s;
        el.tbest.innerHTML = k === null ? '' : `Nejlepší čas <small>— best:</small> ${fmtT(+b[k])}<small>, seed ${String(k).replace(/[<>&]/g, '')}</small>`;
      }
      if (ph === 'dead' || ph === 'won') {
        try { document.exitPointerLock?.(); } catch (e) { /* ignore */ }
        const secs = Math.max(1, Math.round(playT));
        const seed = st.seed ?? '—';
        const best = readBest();
        let rec = false;
        const prm = game.params;
        const cheat = !!(prm?.has?.('god') || prm?.has?.('auto'));
        if (ph === 'won' && st.seed !== undefined && !cheat) {
          const prev = +best[seed];
          if (!(prev > 0) || secs < prev) { best[seed] = secs; writeBest(best); rec = true; }
        }
        const hpLeft = Math.max(0, Math.round(Number.isFinite(P().health) ? P().health : 0));
        let bestS = +best[seed] > 0 ? +best[seed] : 0;
        if (ph === 'won' && (!bestS || secs < bestS)) { bestS = secs; rec = true; }   // a cheat run shows it, never stores it
        const bestTxt = bestS ? fmtT(bestS) : '—';
        const far = ph === 'dead' && RLEN > 0
          ? `<div><b>${Math.round(Math.min(maxProg, RLEN))} m</b>nejdál <small>furthest, of ${Math.round(RLEN)} m</small></div>` : '';
        const html = far + `<div><b>${fmtT(secs)}</b>čas <small>time</small></div>`
          + `<div><b>${killed}</b>mrtvých <small>dead put down</small></div>`
          + `<div><b>${hpLeft}</b>zdraví <small>health left</small></div>`
          + `<div><b>${String(seed).replace(/[<>&]/g, '')}</b>seed <small>?seed=</small></div>`
          + `<div><b>${bestTxt}</b>${rec ? 'nový rekord <small>new best</small>' : 'nejlepší <small>best, this seed</small>'}</div>`;
        (ph === 'dead' ? el.dstats : el.wstats).innerHTML = html;
      }
    });

    // Toasts tick in every phase.
    for (let i = toasts.length - 1; i >= 0; i--) {
      const m = toasts[i];
      m.t -= dt;
      if (m.t < 0.6) m.d.style.opacity = Math.max(0, m.t / 0.6);
      if (m.t <= 0) { m.d.remove(); toasts.splice(i, 1); }
    }
    if (phase !== 'play') return;

    const p = P();
    const yaw = yawOf();

    // Objective + medicine pickup toast.
    const o = objective();
    set('objCz', o.cz, text(el.objCz));
    set('objEn', o.en, text(el.objEn));

    // Clock, and a warning ten minutes before the orloj strikes (once per hour).
    const hr = Number.isFinite(game.time?.hour) ? game.time.hour : 18.7;
    const hh = Math.floor(hr) % 24, mm = Math.floor((hr % 1) * 60);
    set('clock', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, text(el.clock));
    if (hr % 1 >= 0.833 && warnedHour !== hh) { warnedHour = hh; message('Za 10 minut odbíjí orloj — the clock strikes in 10 minutes', 5, 'chime'); }

    // Pickups: announce bandage/ammo from the jumps they cause.
    const hpNow = Number.isFinite(p.health) ? p.health : null;
    if (hpNow !== null && prevHp !== null && hpNow > prevHp + 0.5) message(`+${Math.round(hpNow - prevHp)} zdraví — health`, 2.5, 'pickup-hp');
    prevHp = hpNow;
    const resNow = Number.isFinite(p.reserve) ? p.reserve : null;
    if (resNow !== null && prevRes !== null && resNow > prevRes) message(`+${resNow - prevRes} nábojů — rounds`, 2.5, 'pickup-ammo');
    prevRes = resNow;

    // Detection.
    const watcher = seenNear(p);
    const near = !!watcher;
    set('seen', near, (v) => {
      el.seen.classList.toggle('on', v);
      if (v) { el.seen.classList.remove('pulse'); void el.seen.offsetWidth; el.seen.classList.add('pulse'); }
    });
    if (watcher && typeof watcher === 'object' && p.pos) {
      const rel = wrap(Math.atan2(watcher.x - p.pos.x, -(watcher.z - p.pos.z)) + yaw);
      set('dir', Math.round(rel * 30), (v) => { el.dir.style.transform = `rotate(${(v / 30 * 180 / Math.PI).toFixed(0)}deg)`; el.dir.style.visibility = ''; });
    } else set('dir', 'x', () => { el.dir.style.visibility = 'hidden'; });
    const hrN = Number.isFinite(game.time?.hour) ? game.time.hour : 18;
    set('fl', !!p.flashlight && (hrN >= 19 || hrN < 6), cls(el.fl, 'on'));

    // Hit marker: lastHit is replaced on every shot/swing; only connecting ones mark.
    if (p.lastHit !== lastHitRef) {
      lastHitRef = p.lastHit;
      const h = p.lastHit;
      if (h && (h.id !== undefined || h.melee === true)) hitMark(isHead(h));
    }
    if (hmT > 0) { hmT -= dt; el.hm.style.opacity = Math.max(0, Math.min(1, hmT / 0.12)).toFixed(2); }

    // Route progress.
    if (p.pos && p.pos.x < 1000) { const pr = progressAt(p.pos.x, p.pos.z); if (pr !== null && pr > maxProg) maxProg = pr; }

    // Compass. Bearing clockwise from north: forward = (-sin yaw, -cos yaw) → bearing = -yaw.
    if (!compassW) measure();
    const W = compassW || 400;
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    set('tape', Math.round(heading * 4), () => { el.tape.style.transform = `translateX(${(W / 2 - (heading + 360) * PXDEG).toFixed(1)}px)`; });
    const inside = !!game.interior?.inside;
    let mkX = null, distTxt = '';
    if (o.to && p.pos && !inside) {
      const wp = waypoint(p.pos, o.to);
      const dx = wp.at.x - p.pos.x, dz = wp.at.z - p.pos.z;
      const brg = Math.atan2(dx, -dz);
      const rel = wrap(brg + yaw) * 180 / Math.PI;
      const half = W / 2 / PXDEG;
      mkX = W / 2 + Math.max(-half + 6, Math.min(half - 6, rel)) * PXDEG;
      distTxt = `${Math.round(wp.dist)} m`;
    } else if (o.to && inside) distTxt = st.hasMedicine ? 'ven — get out' : '';
    set('mkVis', mkX !== null, (v) => { el.mk.style.display = v ? '' : 'none'; });
    if (mkX !== null) set('mkX', Math.round(mkX), (v) => { el.mk.style.left = v + 'px'; });
    set('dist', distTxt, text(el.dist));

    // Vitals.
    const hp = Math.max(0, Math.min(100, Number.isFinite(p.health) ? p.health : 100));
    set('hp', Math.round(hp), (v) => { el.hp.style.width = v + '%'; el.hpv.textContent = v; el.hpBar.classList.toggle('low', v <= 30); });
    const sta = Math.max(0, Math.min(1, Number.isFinite(p.stamina) ? p.stamina : 1));
    set('st', Math.round(sta * 100), (v) => { el.st.style.width = v + '%'; });

    // Sprint guess: explicit flag, else stamina falling while loud.
    const falling = sta < prevStamina - 1e-4;
    prevStamina = sta;
    const sprint = p.sprinting ?? p.sprint ?? (falling && (p.noise ?? 0) > 0.5);
    sprintT = sprint ? 0.25 : Math.max(0, sprintT - dt);
    set('xh', sprintT > 0, cls(el.xh, 'wide'));

    // Noise waves.
    const n = Math.max(0, Math.min(1, Number.isFinite(p.noise) ? p.noise : 0));
    const lv = Math.round(n * 20);
    set('noise', lv, (v) => {
      const f = v / 20;
      el.arcs.forEach((a, i) => { a.style.opacity = Math.max(0.12, Math.min(1, (f - i * 0.28) / 0.3)).toFixed(2); });
      el.noise.classList.toggle('loud', f > 0.75);
      el.nl.innerHTML = f < 0.08 ? 'Ticho <small>quiet</small>' : f < 0.4 ? 'Tiše <small>low</small>' : f < 0.75 ? 'Hluk <small>noise</small>' : 'Slyší tě <small>they hear you</small>';
    });

    // Weapon + ammo.
    const w = String(p.weapon || 'crowbar');
    const wl = WEAPONS[w] || [w, ''];
    set('wn', w, () => { el.wn.innerHTML = `${wl[0]}${wl[1] ? ` <small>${wl[1]}</small>` : ''}`; });
    const mag = Number.isFinite(p.ammo) ? p.ammo : 0, res = Number.isFinite(p.reserve) ? p.reserve : 0;
    const hasGun = Number.isFinite(p.ammo);
    const melee = w === 'crowbar' || !hasGun;
    const dry = hasGun && mag + res === 0;
    set('am', `${melee}|${mag}|${dry}`, () => {
      el.am.innerHTML = melee ? '' : String(mag);
      el.am.classList.toggle('empty', !melee && mag === 0);
      el.am.classList.toggle('dry', !melee && dry);
    });
    set('rs', `${melee}|${mag}|${res}|${hasGun}`, () => {
      el.rs.innerHTML = !hasGun ? ''
        : melee ? `Pistole <b>${mag}</b> + <b>${res}</b> <small>pistol rounds</small>`
        : `Zásoba <b>${res}</b> <small>reserve</small>${mag === 0 && res > 0 ? ' · <small>R nabít — reload</small>' : ''}`;
      el.rs.classList.toggle('dry', dry);
    });

    // Stealth kill: crowbar out and dead.js names an unaware target.
    let sk = null;
    try { sk = game.dead?.stealthTarget?.(); } catch (e) { sk = null; }
    set('stl', w === 'crowbar' && sk !== null && sk !== undefined && sk !== false && sk !== -1, cls(el.stl, 'on'));

    // One-off hints, once per run.
    if (!hint.gun && w === 'pistol' && p.pos && p.pos.x > 60 && p.pos.x < 1000) {
      hint.gun = true; message('Výstřel přiláká mrtvé — shots draw the dead', 4, 'hint-gun');
    }
    if (!hint.shove && p.sprinting && p.pos) {
      const CH = game.dead?.debug?.STATES?.CHASE;
      const ls = game.dead?.debug?.near?.(p.pos.x, p.pos.z, 9) || [];
      if (ls.filter((d) => CH === undefined || d.st === CH).length >= 3) {
        hint.shove = true; message('Sprint + úder = odstrčení — swing while sprinting to shove', 5, 'hint-shove');
      }
    }

    // Prompt.
    const pr = p.prompt ? String(p.prompt) : '';
    set('prompt', pr, (v) => {
      el.prompt.classList.toggle('on', !!v);
      el.promptT.innerHTML = v.replace(/[<>&]/g, '').replace(/ — (.*)$/, ' <small>— $1</small>');
    });

    // Damage indicators: re-aim at the attacker as the player turns.
    for (const s of arcs) {
      if (s.t <= 0) { if (s.a.style.opacity !== '0') s.a.style.opacity = '0'; continue; }
      s.t -= dt;
      if (p.pos && s.from) {
        const brg = Math.atan2(s.from.x - p.pos.x, -(s.from.z - p.pos.z));
        const rel = wrap(brg + yaw);
        s.a.style.transform = `rotate(${(rel * 180 / Math.PI).toFixed(1)}deg)`;
      }
      s.a.style.opacity = Math.max(0, Math.min(1, s.t / 0.45)).toFixed(2);
    }
    vigT = Math.max(0, vigT - dt * 0.8);
    const vig = Math.max(vigT, hp < 30 ? (30 - hp) / 60 : 0);
    set('vig', Math.round(vig * 50), (v) => { el.vig.style.opacity = (v / 50).toFixed(2); });
  }

  function measure() { compassW = el.compass.clientWidth || 0; }
  addEventListener('resize', measure);
  game.on?.('resize', measure);

  update(0);
  return { update, message };
}
