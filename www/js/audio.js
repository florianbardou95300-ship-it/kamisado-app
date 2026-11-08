/**
 * Son du jeu — entièrement synthétisé avec la Web Audio API, sans aucun
 * fichier audio externe. Pas de souci de droits, et ça ne pèse rien dans
 * l'APK.
 *
 * - playMoveSound() : un souffle discret, façon vent dans des bambous,
 *   quand une tour se déplace.
 * - musique d'ambiance : une nappe générative discrète, pentatonique,
 *   jouée en boucle pendant une partie (activable/désactivable).
 */

const MUSIC_PREF_KEY = 'kamisado-music-on';

let ctx = null;
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Débloque l'audio dès la première interaction (politique autoplay mobile).
['pointerdown', 'touchstart'].forEach((evt) => {
  document.addEventListener(evt, () => getCtx(), { once: true, passive: true });
});

export function playMoveSound() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const dur = 0.5 + Math.random() * 0.15;

  // Un souffle de bruit filtré, dont le filtre redescend doucement en
  // fréquence — une petite rafale de vent qui s'éloigne.
  const bufferSize = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buffer;

  const bandpass = ac.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(2100 + Math.random() * 500, now);
  bandpass.frequency.exponentialRampToValueAtTime(420, now + dur);
  bandpass.Q.value = 0.6;

  // Enveloppe douce : montée et descente progressives, jamais de clic sec.
  const envelope = ac.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(0.1, now + 0.16);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  // Léger frémissement (tremolo) pour évoquer le bruissement des feuilles.
  const tremolo = ac.createOscillator();
  tremolo.frequency.value = 6 + Math.random() * 4;
  const tremoloDepth = ac.createGain();
  tremoloDepth.gain.value = 0.35;
  const tremoloCenter = ac.createConstantSource();
  tremoloCenter.offset.value = 0.75;
  const tremoloGain = ac.createGain();
  tremolo.connect(tremoloDepth).connect(tremoloGain.gain);
  tremoloCenter.connect(tremoloGain.gain);

  noise.connect(bandpass).connect(envelope).connect(tremoloGain).connect(ac.destination);

  noise.start(now);
  noise.stop(now + dur + 0.05);
  tremolo.start(now);
  tremolo.stop(now + dur + 0.05);
  tremoloCenter.start(now);
  tremoloCenter.stop(now + dur + 0.05);
}

/**
 * Clic sec façon billes de verre/céramique qui s'entrechoquent, pour
 * chaque coup joué à Abalone.
 */
export function playAbaloneMoveSound() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Quelques partiels non harmoniques, façon petit choc de verre/céramique.
  const partials = [
    { ratio: 1, gain: 0.16, decay: 0.09 },
    { ratio: 2.76, gain: 0.1, decay: 0.07 },
    { ratio: 4.4, gain: 0.05, decay: 0.05 },
  ];
  const base = 2000 + Math.random() * 500;
  for (const p of partials) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * p.ratio;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(p.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + p.decay);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + p.decay + 0.02);
  }

  // Un tout petit "clac" de bruit à l'attaque pour la texture du choc.
  const clickDur = 0.02;
  const bufferSize = Math.floor(ac.sampleRate * clickDur);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.12;
  noise.connect(hp).connect(noiseGain).connect(ac.destination);
  noise.start(now);
}

/**
 * Son marquant la sortie d'une bille du plateau à Abalone : une petite
 * chute, avec un dernier "tac" plus grave qui évoque la bille tombant
 * hors du jeu.
 */
export function playAbaloneCaptureSound() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // D'abord le choc initial (comme un coup normal, mais un peu plus fort).
  playAbaloneMoveSound();

  // Puis une glissade descendante qui évoque la chute...
  const fall = ac.createOscillator();
  fall.type = 'sine';
  fall.frequency.setValueAtTime(900, now + 0.03);
  fall.frequency.exponentialRampToValueAtTime(140, now + 0.26);
  const fallGain = ac.createGain();
  fallGain.gain.setValueAtTime(0.0001, now + 0.03);
  fallGain.gain.exponentialRampToValueAtTime(0.14, now + 0.08);
  fallGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.28);
  fall.connect(fallGain).connect(ac.destination);
  fall.start(now + 0.03);
  fall.stop(now + 0.3);

  // ...et un petit "tac" grave final, l'atterrissage.
  const thud = ac.createOscillator();
  thud.type = 'triangle';
  thud.frequency.value = 95;
  const thudGain = ac.createGain();
  thudGain.gain.setValueAtTime(0.0001, now + 0.27);
  thudGain.gain.exponentialRampToValueAtTime(0.22, now + 0.29);
  thudGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.4);
  thud.connect(thudGain).connect(ac.destination);
  thud.start(now + 0.27);
  thud.stop(now + 0.42);
}

export function playWinSound() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const notes = [392.0, 523.25, 659.25, 784.0]; // sol, do, mi, sol (octave sup)
  notes.forEach((freq, i) => {
    const t = now + i * 0.11;
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// ---------- Musique d'ambiance générative ----------

// Gamme pentatonique mineure (couleur "japonisante" douce), sur deux octaves.
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0];

let musicOn = false;
let nextNoteTime = 0;
let schedulerTimer = null;

function scheduleNote(ac, time, freq, dur) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.05, time + 0.5);
  gain.gain.linearRampToValueAtTime(0, time + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(time);
  osc.stop(time + dur + 0.05);
}

function musicScheduler() {
  if (!musicOn) return;
  const ac = getCtx();
  if (!ac) return;
  while (nextNoteTime < ac.currentTime + 2.5) {
    const freq = SCALE[Math.floor(Math.random() * SCALE.length)];
    const dur = 1.8 + Math.random() * 1.4;
    scheduleNote(ac, nextNoteTime, freq, dur);
    nextNoteTime += 1.1 + Math.random() * 1.0;
  }
  schedulerTimer = setTimeout(musicScheduler, 500);
}

export function startMusic() {
  if (musicOn) return;
  const ac = getCtx();
  if (!ac) return;
  musicOn = true;
  nextNoteTime = ac.currentTime + 0.2;
  musicScheduler();
}

export function stopMusic() {
  musicOn = false;
  if (schedulerTimer) clearTimeout(schedulerTimer);
}

export function isMusicPrefOn() {
  const stored = localStorage.getItem(MUSIC_PREF_KEY);
  return stored === null ? true : stored === '1'; // activée par défaut
}

export function setMusicPref(on) {
  try { localStorage.setItem(MUSIC_PREF_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}
