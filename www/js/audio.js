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
