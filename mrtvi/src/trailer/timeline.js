// The trailer, shot by shot. Shared by the director (src/trailer.js) and the score (src/trailer/music.js).
// Times in seconds from the moment the viewer presses play. Total ≈ 80 s.

export const SHOTS = [
  { id: 'river',    t: 0,  dur: 8,  hour: 18.4, note: 'High, slow drift over the Vltava from the south; fog; the bridge and castle as silhouettes.' },
  { id: 'celetna',  t: 8,  dur: 8,  hour: 18.6, note: 'Walking-height push west down Celetná in drizzle; a lone walker crosses far ahead.' },
  { id: 'pharmacy', t: 16, dur: 9,  hour: 21,   note: 'Inside the pharmacy, flashlight sweeps shelves, finds the red-cross case; a walker silhouette rises against the window.' },
  { id: 'clock',    t: 25, dur: 8,  hour: 19.0, note: 'Slow tilt up the clock tower to the dial; the bell strikes (real chime).' },
  { id: 'square',   t: 33, dur: 9,  hour: 19.0, note: 'High angle over Old Town Square: the dead stop, turn, and drift in toward the clock.' },
  { id: 'bridge',   t: 42, dur: 8,  hour: 19.6, note: 'Low tracking shot along Charles Bridge through a lane in the horde; statues overhead.' },
  { id: 'cuts',     t: 50, dur: 8,  hour: 21,   note: 'Fast cuts (~1.5 s each): flashlight on a face at 2 m; muzzle flash in an alley; a runner lunging; a body falling.' },
  { id: 'nerudova', t: 58, dur: 8,  hour: 20.5, note: 'Climbing Nerudova at night, flashlight on cobbles, the castle and its fires above.' },
  { id: 'camp',     t: 66, dur: 6,  hour: 20.5, note: 'The camp: fires, the medic turns toward camera.' },
  { id: 'black',    t: 72, dur: 2,  hour: 20.5, note: 'Black. Silence.' },
  { id: 'title',    t: 74, dur: 6,  hour: 20.5, note: 'MRTVÍ logo over a dim slow drift; HRÁT / PLAY button appears and stays.' },
];

// Title cards: Czech large, English small beneath.
export const CARDS = [
  { t: 2.5,  dur: 4,   cz: 'Praha. 47 dní poté.',        en: 'Prague. 47 days after.' },
  { t: 10,   dur: 4,   cz: 'Město mlčí.',                en: 'The city is silent.' },
  { t: 19.5, dur: 4,   cz: 'Někdo potřebuje léky.',      en: 'Someone needs medicine.' },
  { t: 28,   dur: 4,   cz: 'Orloj stále bije…',          en: 'The clock still strikes…' },
  { t: 37,   dur: 4,   cz: '…a oni přicházejí.',         en: '…and they come.' },
  { t: 61,   dur: 4,   cz: 'Dones je na Hrad.',          en: 'Get it to the Castle.' },
  { t: 68,   dur: 3.5, cz: 'Nesmí tě slyšet.',           en: 'Don\'t let them hear you.' },
];

// Music cues for the score. kind: 'drone-in' | 'pulse-in' | 'bell' | 'hit' | 'riser' | 'stop' | 'logo'
export const CUES = [
  { t: 0,    kind: 'drone-in' },
  { t: 16,   kind: 'pulse-in' },          // slow heartbeat-like pulse joins
  { t: 22.5, kind: 'hit' },               // walker rises in the window
  { t: 26,   kind: 'bell' },              // the clock strikes (world chime also plays)
  { t: 42,   kind: 'riser' },             // builds through the bridge
  { t: 50,   kind: 'hit' }, { t: 51.5, kind: 'hit' }, { t: 53, kind: 'hit' }, { t: 54.5, kind: 'hit' }, { t: 56, kind: 'hit' },
  { t: 58,   kind: 'riser' },
  { t: 72,   kind: 'stop' },              // hard cut to silence
  { t: 74,   kind: 'logo' },              // one huge bell + sub boom under the logo, long tail
];

export const LENGTH = 80;
