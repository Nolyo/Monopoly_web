// Bruitages du jeu — Web Audio API, sans dépendance.
// Rien n'est instancié au chargement du module : initSounds() est appelée au
// premier clic utilisateur (autorisation audio des navigateurs), et tout échec
// (fichier manquant, API absente, stockage indisponible) est silencieux : le
// jeu fonctionne simplement sans son, comme storage.js pour la sauvegarde.

export const SOUNDS = {
  dice:     { file: 'dice.ogg',     volume: 0.9 },  // dés qui roulent
  hop:      { file: 'hop.ogg',      volume: 0.35 }, // pas du pion, discret
  buy:      { file: 'buy.ogg',      volume: 0.8 },  // achat de propriété
  pay:      { file: 'pay.ogg',      volume: 0.8 },  // argent qui sort
  cash:     { file: 'cash.ogg',     volume: 0.8 },  // argent qui rentre
  card:     { file: 'card.ogg',     volume: 0.9 },  // carte retournée
  jail:     { file: 'jail.ogg',     volume: 0.9 },  // porte de prison
  build:    { file: 'build.ogg',    volume: 0.8 },  // construction
  bankrupt: { file: 'bankrupt.ogg', volume: 0.9 },  // jingle de faillite
  win:      { file: 'win.ogg',      volume: 1.0 },  // fanfare de victoire
};

const MUTE_KEY = 'monopoly3d.muted';

let ctx = null;      // AudioContext (null tant qu'initSounds n'a pas réussi)
let master = null;   // gain maître (0 quand le son est coupé)
const buffers = {};  // nom → AudioBuffer décodé
let muted = false;

export function isMuted() {
  return muted;
}

export function initSounds() {
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { muted = false; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    return;
  }
  for (const [name, def] of Object.entries(SOUNDS)) {
    fetch(`sounds/${def.file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .then((audio) => { buffers[name] = audio; })
      .catch(() => {}); // fichier manquant : le jeu tourne sans ce son
  }
}

export function playSound(name) {
  try {
    if (!ctx || !buffers[name] || muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    const gain = ctx.createGain();
    gain.gain.value = SOUNDS[name].volume;
    src.connect(gain).connect(master);
    src.start();
  } catch { /* le son ne doit jamais casser le jeu */ }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 1;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* non persisté */ }
  return muted;
}
