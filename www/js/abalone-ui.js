/**
 * Interface du jeu Abalone : plateau hexagonal en SVG, billes façon
 * verre/céramique avec un effet 3D.
 *
 * Interaction (au doigt, en un seul geste fluide) :
 *  1. On pose le doigt sur une de ses billes : elle est entourée.
 *  2. Sans relâcher, on glisse le doigt le long de la ligne pour
 *     agrandir la sélection à 2 ou 3 billes : un ovale entoure alors
 *     tout le groupe (plus de cercle par bille).
 *  3. On continue à glisser, cette fois hors de la ligne (ou qu'il n'y
 *     a plus de bille à ajouter) : le groupe suit le doigt et se cale
 *     sur la direction la plus proche parmi les coups possibles.
 *  4. On relâche : si une direction valide était visée, le coup est
 *     joué. Sinon, tout revient à sa place.
 * On peut aussi relâcher après l'étape 2 puis reposer le doigt sur la
 * sélection pour la glisser plus tard : les deux approches marchent.
 */
import {
  BLACK, WHITE, DIRECTIONS, createInitialState, allCells, ownerAt,
  validateGroup, legalMovesForGroup, applyGroupMove, neighbor, inBounds,
} from './abalone.js';
import {
  playAbaloneMoveSound, playAbaloneCaptureSound,
  startMusic, stopMusic, isMusicPrefOn, setMusicPref,
} from './audio.js';
import { chooseAbaloneAiMove } from './abalone-ai.js';
import { P2PConnection } from './webrtc.js';

const UNIT = 11; // espacement entre centres de cases voisines
const RADIUS_CELL = 4.6; // rayon d'une case / bille
// Doit dépasser UNIT/2 (le point où nearestCell bascule vers la case suivante),
// sinon le geste abandonne la sélection juste avant d'atteindre cette case.
const MIN_DRAG = UNIT * 0.58; // distance avant de considérer que le doigt quitte la ligne
const MAX_PREVIEW_OFFSET = UNIT * 0.62; // décalage visuel max pendant le glissement
const AIM_COS_TOLERANCE = Math.cos(40 * Math.PI / 180);

// Chaque palette donne les 4 arrêts (effet verre/céramique) des deux
// camps — "black" = camp qui commence (BLACK), "white" = l'autre (WHITE).
// La forme du dégradé (reflet clair -> teinte -> ombre -> bord sombre)
// est la même pour toutes les palettes, seules les couleurs changent.
const MARBLE_PALETTES = {
  'black-white': {
    label: 'Noir / Blanc',
    names: ['Noir', 'Blanc'],
    swatch: ['#2c2c35', '#dcccab'],
    black: [['0%', '#75757f'], ['28%', '#2c2c35'], ['70%', '#0c0c11'], ['100%', '#000000']],
    white: [['0%', '#ffffff'], ['35%', '#f6ecdb'], ['75%', '#dcccab'], ['100%', '#b8a98a']],
  },
  'red-blue': {
    label: 'Rouge / Bleu',
    names: ['Rouge', 'Bleu'],
    swatch: ['#e23b3b', '#3b6fe2'],
    black: [['0%', '#ffd9d9'], ['30%', '#e23b3b'], ['75%', '#7a1414'], ['100%', '#1f0606']],
    white: [['0%', '#d9e6ff'], ['30%', '#3b6fe2'], ['75%', '#14307a'], ['100%', '#06102b']],
  },
  'green-yellow': {
    label: 'Vert / Jaune',
    names: ['Vert', 'Jaune'],
    swatch: ['#35b24a', '#e8c93a'],
    black: [['0%', '#ddffe0'], ['30%', '#35b24a'], ['75%', '#0f5c1d'], ['100%', '#042209']],
    white: [['0%', '#fff8d9'], ['30%', '#e8c93a'], ['75%', '#8a6f12'], ['100%', '#2e2403']],
  },
  'purple-orange': {
    label: 'Violet / Orange',
    names: ['Violet', 'Orange'],
    swatch: ['#8a3ae8', '#e8833a'],
    black: [['0%', '#ecd9ff'], ['30%', '#8a3ae8'], ['75%', '#481280'], ['100%', '#19052b']],
    white: [['0%', '#ffe8d9'], ['30%', '#e8833a'], ['75%', '#8a4414'], ['100%', '#2e1505']],
  },
};
const PALETTE_PREF_KEY = 'samourai_abalone_palette';
function loadPalettePref() {
  try {
    const v = localStorage.getItem(PALETTE_PREF_KEY);
    return v && MARBLE_PALETTES[v] ? v : 'black-white';
  } catch (e) { return 'black-white'; }
}
function savePalettePref(id) {
  try { localStorage.setItem(PALETTE_PREF_KEY, id); } catch (e) { /* ignore */ }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function hexToPixel(q, r) {
  return { x: UNIT * (q + r / 2), y: UNIT * (r * Math.sqrt(3) / 2) };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

async function shareOrCopy(text) {
  if (!text) return;
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) { /* annulé, on retente la copie */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Code copié dans le presse-papiers.');
  } catch (e) {
    alert('Impossible de copier automatiquement. Sélectionne le texte manuellement.');
  }
}

const TRAY_SLOTS = 6;

function buildTray(svgEl, fillUrl) {
  svgEl.innerHTML = '';
  const svgns = 'http://www.w3.org/2000/svg';
  const spacing = 160 / TRAY_SLOTS;
  for (let i = 0; i < TRAY_SLOTS; i++) {
    const cx = spacing * i + spacing / 2;
    const cy = 15;
    const hole = document.createElementNS(svgns, 'circle');
    hole.setAttribute('cx', cx);
    hole.setAttribute('cy', cy);
    hole.setAttribute('r', 10);
    hole.setAttribute('class', 'abalone-tray-hole');
    svgEl.appendChild(hole);

    const marble = document.createElementNS(svgns, 'circle');
    marble.setAttribute('cx', cx);
    marble.setAttribute('cy', cy);
    marble.setAttribute('r', 9.4);
    marble.setAttribute('class', 'abalone-tray-marble');
    marble.setAttribute('fill', fillUrl);
    marble.setAttribute('visibility', 'hidden');
    svgEl.appendChild(marble);
  }
}

function renderTray(svgEl, count) {
  const marbles = svgEl.querySelectorAll('.abalone-tray-marble');
  marbles.forEach((m, i) => {
    m.setAttribute('visibility', i < count ? 'visible' : 'hidden');
  });
}

export function initAbalone() {
  const svg = document.getElementById('board-abalone');
  const hudTurn = document.getElementById('abalone-hud-turn');
  const trayBlack = document.getElementById('abalone-tray-black');
  const trayWhite = document.getElementById('abalone-tray-white');
  const banner = document.getElementById('abalone-banner');
  const bannerText = document.getElementById('abalone-banner-text');
  const hudConn = document.getElementById('abalone-hud-conn');

  const cells = allCells();
  const pixelByKey = new Map();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    const p = hexToPixel(c.q, c.r);
    pixelByKey.set(`${c.q},${c.r}`, p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const margin = RADIUS_CELL * 1.8;
  svg.setAttribute('viewBox', `${minX - margin} ${minY - margin} ${(maxX - minX) + margin * 2} ${(maxY - minY) + margin * 2}`);

  const dirPixel = DIRECTIONS.map((d) => hexToPixel(d.q, d.r));

  let state = null;
  let selected = []; // [{q,r}, ...] dans l'ordre de sélection
  let currentMoves = []; // coups légaux pour `selected`, recalculés à chaque changement
  let phase = 'idle'; // 'idle' | 'selecting' | 'arming' | 'moving'
  let dragStart = null;
  let aimedMove = null;
  let capsuleEl = null;
  let boardGroupEl = null;
  let moveAnimating = false;
  let armTimer = null;
  let lastDragPoint = null;
  // Petit temps de latence entre "sélectionner la ligne" et "viser une
  // direction" : évite qu'un seul geste continu du doigt déclenche un
  // déplacement non voulu juste après avoir fini de sélectionner.
  const MOVE_ARM_DELAY_MS = 160;

  function clearArmTimer() {
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  }

  let palette = loadPalettePref();
  function currentPalette() { return MARBLE_PALETTES[palette] || MARBLE_PALETTES['black-white']; }
  function playerLabel(owner) {
    const names = currentPalette().names;
    return owner === BLACK ? names[0] : names[1];
  }
  function updateTrayLabels() {
    const names = currentPalette().names;
    const lblBlack = document.getElementById('abalone-tray-label-black');
    const lblWhite = document.getElementById('abalone-tray-label-white');
    if (lblBlack) lblBlack.textContent = `${names[0]} sorties`;
    if (lblWhite) lblWhite.textContent = `${names[1]} sorties`;
  }
  let mode = 'local'; // 'local' | 'ai' | 'online'
  let humanOwner = BLACK; // mode IA : camp tenu par l'humain (l'IA joue l'autre)
  let myOwner = BLACK; // mode en ligne : rôle du joueur local
  let aiDifficulty = 'moyen';
  let aiThinking = false;
  let matchToken = 0; // incrémenté à chaque nouvelle partie, pour ignorer un coup IA en retard
  let net = null; // P2PConnection en mode en ligne

  function pixelOf(c) { return pixelByKey.get(`${c.q},${c.r}`); }
  function cellEl(q, r) { return svg.querySelector(`[data-cell="${q},${r}"]`); }
  function sameCell(a, b) { return a.q === b.q && a.r === b.r; }
  function containsCell(arr, c) { return arr.some((x) => sameCell(x, c)); }

  /**
   * Le joueur humain voit toujours ses propres billes en bas de l'écran :
   * sans retournement, le blanc est en bas (r positif) et le noir en haut.
   * Si l'humain joue noir, on retourne l'affichage du plateau à 180°
   * (un simple `transform="rotate(180)"` sur le groupe qui porte toutes
   * les cases — la logique du jeu et les coordonnées q,r restent inchangées).
   */
  function isFlipped() {
    if (mode === 'online') return myOwner === BLACK;
    if (mode === 'ai') return humanOwner === BLACK;
    return false;
  }

  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const m = svg.getScreenCTM().inverse();
    const p = pt.matrixTransform(m);
    // Le CTM ci-dessus mesure dans le repère racine du <svg> (non affecté par
    // la rotation du groupe interne) : on compense donc nous-mêmes le
    // retournement pour retomber dans le même repère que hexToPixel/pixelOf.
    return isFlipped() ? { x: -p.x, y: -p.y } : { x: p.x, y: p.y };
  }

  function nearestCell(p) {
    let best = null, bestD = Infinity;
    for (const c of cells) {
      const d = dist(p, pixelOf(c));
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= UNIT * 0.62 ? best : null;
  }

  function buildDefs() {
    const svgns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(svgns, 'defs');
    const grad = (id, stops) => {
      const g = document.createElementNS(svgns, 'radialGradient');
      g.setAttribute('id', id);
      g.setAttribute('cx', '35%'); g.setAttribute('cy', '28%'); g.setAttribute('r', '75%');
      for (const [offset, color] of stops) {
        const stop = document.createElementNS(svgns, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        g.appendChild(stop);
      }
      defs.appendChild(g);
    };
    const pal = MARBLE_PALETTES[palette] || MARBLE_PALETTES['black-white'];
    grad('marbleBlack', pal.black);
    grad('marbleWhite', pal.white);
    svg.appendChild(defs);
  }

  function buildBoard() {
    svg.innerHTML = '';
    buildDefs();
    const svgns = 'http://www.w3.org/2000/svg';
    const boardGroup = document.createElementNS(svgns, 'g');
    boardGroup.setAttribute('id', 'abalone-board-group');
    if (isFlipped()) boardGroup.setAttribute('transform', 'rotate(180)');
    svg.appendChild(boardGroup);
    boardGroupEl = boardGroup;
    for (const c of cells) {
      const p = pixelOf(c);
      const g = document.createElementNS(svgns, 'g');
      g.setAttribute('data-cell', `${c.q},${c.r}`);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);

      const hole = document.createElementNS(svgns, 'circle');
      hole.setAttribute('r', RADIUS_CELL);
      hole.setAttribute('class', 'abalone-hole');
      g.appendChild(hole);

      const marble = document.createElementNS(svgns, 'circle');
      marble.setAttribute('r', RADIUS_CELL * 0.86);
      marble.setAttribute('class', 'abalone-marble');
      marble.setAttribute('visibility', 'hidden');
      g.appendChild(marble);

      const glint = document.createElementNS(svgns, 'ellipse');
      glint.setAttribute('class', 'abalone-glint');
      glint.setAttribute('cx', -RADIUS_CELL * 0.28);
      glint.setAttribute('cy', -RADIUS_CELL * 0.38);
      glint.setAttribute('rx', RADIUS_CELL * 0.26);
      glint.setAttribute('ry', RADIUS_CELL * 0.16);
      // Compense la rotation du groupe parent pour que le reflet de lumière
      // garde toujours la même orientation à l'écran, plateau retourné ou non.
      glint.setAttribute('transform', isFlipped() ? 'rotate(145)' : 'rotate(-35)');
      glint.setAttribute('visibility', 'hidden');
      g.appendChild(glint);

      boardGroup.appendChild(g);
    }

    capsuleEl = document.createElementNS(svgns, 'line');
    capsuleEl.setAttribute('class', 'abalone-selection');
    capsuleEl.setAttribute('stroke-linecap', 'round');
    capsuleEl.setAttribute('visibility', 'hidden');
    boardGroup.appendChild(capsuleEl);

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    if (trayBlack) buildTray(trayBlack, 'url(#marbleBlack)');
    if (trayWhite) buildTray(trayWhite, 'url(#marbleWhite)');
  }

  function renderBoardState() {
    for (const c of cells) {
      const g = cellEl(c.q, c.r);
      const owner = ownerAt(state, c.q, c.r);
      const marble = g.querySelector('.abalone-marble');
      const glint = g.querySelector('.abalone-glint');
      g.setAttribute('transform', `translate(${pixelOf(c).x},${pixelOf(c).y})`);
      if (owner) {
        marble.setAttribute('visibility', 'visible');
        marble.setAttribute('fill', owner === BLACK ? 'url(#marbleBlack)' : 'url(#marbleWhite)');
        glint.setAttribute('visibility', 'visible');
      } else {
        marble.setAttribute('visibility', 'hidden');
        glint.setAttribute('visibility', 'hidden');
      }
    }
    if (aiThinking) {
      hudTurn.textContent = "L'IA réfléchit…";
    } else if (mode === 'online') {
      hudTurn.textContent = state.turn === myOwner ? 'À toi de jouer' : "À l'adversaire";
    } else {
      hudTurn.textContent = `Au tour de : ${playerLabel(state.turn)}`;
    }
    if (trayBlack) renderTray(trayBlack, state.score[BLACK]);
    if (trayWhite) renderTray(trayWhite, state.score[WHITE]);
    if (state.winner) {
      banner.classList.remove('hidden');
      bannerText.textContent = `${playerLabel(state.winner)} gagne ! (6 billes sorties)`;
    } else {
      banner.classList.add('hidden');
    }
  }

  function renderCapsule(offset, tint) {
    if (selected.length === 0) {
      capsuleEl.setAttribute('visibility', 'hidden');
      return;
    }
    const a = pixelOf(selected[0]);
    const b = pixelOf(selected[selected.length - 1]);
    const ox = offset ? offset.x : 0, oy = offset ? offset.y : 0;
    capsuleEl.setAttribute('x1', a.x + ox);
    capsuleEl.setAttribute('y1', a.y + oy);
    capsuleEl.setAttribute('x2', b.x + ox);
    capsuleEl.setAttribute('y2', b.y + oy);
    capsuleEl.setAttribute('stroke-width', RADIUS_CELL * 2 + 4.4);
    capsuleEl.setAttribute('stroke', tint || '#ffd27a');
    capsuleEl.setAttribute('visibility', 'visible');
  }

  function setGroupOffset(offset) {
    for (const c of selected) {
      const g = cellEl(c.q, c.r);
      const p = pixelOf(c);
      g.setAttribute('transform', `translate(${p.x + (offset ? offset.x : 0)},${p.y + (offset ? offset.y : 0)})`);
    }
  }

  function resetGroupOffset() {
    for (const c of selected) {
      const g = cellEl(c.q, c.r);
      const p = pixelOf(c);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
  }

  function recomputeCurrentMoves() {
    if (selected.length === 0) { currentMoves = []; return; }
    const v = validateGroup(state, selected, state.turn);
    if (!v.valid) { currentMoves = []; return; }
    const moves = legalMovesForGroup(state, v.ordered, v.axisIndex, state.turn, v.axisDir);
    currentMoves = moves.map((move) => ({ ordered: v.ordered, move }));
  }

  function snapDirection(vec) {
    const mag = Math.hypot(vec.x, vec.y);
    if (mag < MIN_DRAG) return null;
    const nx = vec.x / mag, ny = vec.y / mag;
    let best = null, bestDot = -Infinity;
    for (const m of currentMoves) {
      const dv = dirPixel[m.move.dirIndex];
      const dmag = Math.hypot(dv.x, dv.y);
      const dot = (nx * dv.x + ny * dv.y) / dmag;
      if (dot > bestDot) { bestDot = dot; best = m; }
    }
    return best && bestDot >= AIM_COS_TOLERANCE ? best : null;
  }

  function clearSelection() {
    clearArmTimer();
    selected = [];
    currentMoves = [];
    phase = 'idle';
    aimedMove = null;
    renderCapsule(null, null);
  }

  function finishGesture(executed) {
    clearArmTimer();
    if (!executed) {
      resetGroupOffset();
      renderCapsule(null, null);
    }
    phase = 'idle';
    dragStart = null;
    aimedMove = null;
  }

  const ABALONE_ANIMATE_MS = 340;

  /**
   * Fait glisser visuellement les billes du groupe déplacé (et, en cas de
   * capture, les billes adverses poussées — la dernière continuant hors
   * du plateau en s'estompant) avant d'appliquer le coup, pour que le
   * déplacement — humain, IA, ou reçu en ligne — soit toujours visible.
   */
  function animateAbaloneMove(ordered, move, onDone) {
    if (!boardGroupEl) { onDone(); return; }
    const dv = dirPixel[move.dirIndex];
    const steps = ordered.map((c) => ({ cell: c, dropOff: false }));
    (move.pushedCells || []).forEach((c) => {
      const n = neighbor(c.q, c.r, move.dirIndex);
      steps.push({ cell: c, dropOff: !inBounds(n.q, n.r) });
    });

    const svgns = 'http://www.w3.org/2000/svg';
    const ghosts = [];
    steps.forEach(({ cell, dropOff }) => {
      const src = cellEl(cell.q, cell.r);
      const marbleEl = src ? src.querySelector('.abalone-marble') : null;
      if (!marbleEl || marbleEl.getAttribute('visibility') !== 'visible') return;
      const glintEl = src.querySelector('.abalone-glint');
      const start = pixelOf(cell);

      const ghost = document.createElementNS(svgns, 'g');
      ghost.setAttribute('transform', `translate(${start.x},${start.y})`);
      ghost.style.pointerEvents = 'none';
      const mClone = marbleEl.cloneNode(true);
      mClone.removeAttribute('visibility');
      ghost.appendChild(mClone);
      if (glintEl && glintEl.getAttribute('visibility') === 'visible') {
        const gClone = glintEl.cloneNode(true);
        gClone.removeAttribute('visibility');
        ghost.appendChild(gClone);
      }
      boardGroupEl.appendChild(ghost);
      marbleEl.setAttribute('visibility', 'hidden');
      if (glintEl) glintEl.setAttribute('visibility', 'hidden');
      ghosts.push({ ghost, start, dropOff });
    });

    if (!ghosts.length) { onDone(); return; }

    const startTime = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - startTime) / ABALONE_ANIMATE_MS);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      ghosts.forEach(({ ghost, start, dropOff }) => {
        const factor = dropOff ? 1.7 : 1; // continue un peu plus loin : effet de chute hors du plateau
        const x = start.x + dv.x * factor * ease;
        const y = start.y + dv.y * factor * ease;
        ghost.setAttribute('transform', `translate(${x},${y})`);
        if (dropOff) ghost.style.opacity = String(1 - ease);
      });
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        ghosts.forEach(({ ghost }) => ghost.remove());
        onDone();
      }
    }
    requestAnimationFrame(tick);
  }

  function executeMove(picked, fromRemote) {
    const capture = picked.move.capture;
    const mover = state.turn;
    // Envoyé tout de suite (avant l'animation locale) pour que l'adversaire,
    // en ligne, voie le coup glisser sans attendre notre propre animation.
    if (mode === 'online' && !fromRemote && net) {
      net.send({
        type: 'move',
        group: picked.ordered.map((c) => ({ q: c.q, r: c.r })),
        dirIndex: picked.move.dirIndex,
      });
    }
    moveAnimating = true;
    animateAbaloneMove(picked.ordered, picked.move, () => {
      moveAnimating = false;
      state = applyGroupMove(state, picked.ordered, picked.move, mover);
      selected = [];
      currentMoves = [];
      renderBoardState();
      renderCapsule(null, null);
      if (capture) playAbaloneCaptureSound(); else playAbaloneMoveSound();
      if (!fromRemote) maybeScheduleAiMove();
    });
  }

  /** En mode IA, si c'est au tour de la machine, calcule et joue son coup. */
  function maybeScheduleAiMove() {
    if (mode !== 'ai' || !state || state.winner || state.turn === humanOwner) return;
    aiThinking = true;
    renderBoardState();
    const token = matchToken;
    setTimeout(() => {
      if (token !== matchToken) return; // partie quittée/relancée entre-temps
      const picked = chooseAbaloneAiMove(state, aiDifficulty);
      aiThinking = false;
      if (picked) {
        executeMove(picked, false);
      } else {
        renderBoardState();
      }
    }, 350);
  }

  function canInteract() {
    if (!state || state.winner || aiThinking || moveAnimating) return false;
    if (mode === 'ai') return state.turn === humanOwner;
    if (mode === 'online') return state.turn === myOwner;
    return true;
  }

  function onPointerDown(e) {
    if (!canInteract()) return;
    const p = toSvgPoint(e);
    const downCell = nearestCell(p);
    if (!downCell) return;
    svg.setPointerCapture(e.pointerId);
    clearArmTimer();

    if (selected.length > 0 && containsCell(selected, downCell)) {
      phase = 'moving';
      dragStart = p;
      aimedMove = null;
    } else {
      if (ownerAt(state, downCell.q, downCell.r) !== state.turn) return;
      selected = [downCell];
      recomputeCurrentMoves();
      phase = 'selecting';
      renderCapsule(null, '#ffd27a');
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (phase === 'idle') return;
    const p = toSvgPoint(e);
    e.preventDefault();

    if (phase === 'selecting') {
      const hovered = nearestCell(p);
      if (hovered && selected.length < 3 && !containsCell(selected, hovered)) {
        const tentative = [...selected, hovered];
        const v = validateGroup(state, tentative, state.turn);
        if (v.valid) {
          selected = tentative;
          recomputeCurrentMoves();
          renderCapsule(null, '#ffd27a');
          return;
        }
      }
      const lastCenter = pixelOf(selected[selected.length - 1]);
      if (dist(p, lastCenter) > MIN_DRAG) {
        // On ne bascule pas tout de suite en visée de direction : un court
        // temps de latence doit s'écouler pour que "finir de sélectionner"
        // et "viser un déplacement" restent deux gestes bien distincts.
        phase = 'arming';
        lastDragPoint = p;
        clearArmTimer();
        armTimer = setTimeout(() => {
          armTimer = null;
          if (phase === 'arming') {
            phase = 'moving';
            dragStart = lastDragPoint;
          }
        }, MOVE_ARM_DELAY_MS);
      }
      return;
    }

    if (phase === 'arming') {
      lastDragPoint = p;
      const lastCenter = pixelOf(selected[selected.length - 1]);
      if (dist(p, lastCenter) <= MIN_DRAG) {
        // Le doigt est revenu près de la ligne sélectionnée : on annule
        // l'armement, l'utilisateur n'a pas encore décidé de bouger.
        clearArmTimer();
        phase = 'selecting';
      }
      return;
    }

    if (phase === 'moving') {
      const vec = { x: p.x - dragStart.x, y: p.y - dragStart.y };
      aimedMove = snapDirection(vec);
      if (aimedMove) {
        const dv = dirPixel[aimedMove.move.dirIndex];
        const dmag = Math.hypot(dv.x, dv.y);
        const mag = Math.min(Math.hypot(vec.x, vec.y), MAX_PREVIEW_OFFSET);
        const offset = { x: (dv.x / dmag) * mag, y: (dv.y / dmag) * mag };
        setGroupOffset(offset);
        renderCapsule(offset, '#59d98e');
      } else {
        resetGroupOffset();
        renderCapsule(null, '#ffd27a');
      }
    }
  }

  function onPointerUp(e) {
    if (phase === 'moving' && aimedMove) {
      executeMove(aimedMove);
      finishGesture(true);
      return;
    }
    finishGesture(false);
  }

  function startMatch(newMode) {
    mode = newMode;
    matchToken++;
    aiThinking = false;
    moveAnimating = false;
    state = createInitialState();
    selected = []; currentMoves = []; phase = 'idle'; aimedMove = null;
    if (hudConn) hudConn.textContent = mode === 'online' ? '🌐' : mode === 'ai' ? '🤖' : '';
    updateTrayLabels();
    buildBoard();
    renderBoardState();
    showScreen('screen-abalone-game');
    if (isMusicPrefOn()) startMusic();
    maybeScheduleAiMove();
  }

  function handleAbaloneNetMessage(msg) {
    if (msg.type === 'hello') {
      myOwner = msg.ownerForYou;
      startMatch('online');
    } else if (msg.type === 'move') {
      if (!state || state.winner) return;
      const group = msg.group.map((c) => ({ q: c.q, r: c.r }));
      const v = validateGroup(state, group, state.turn);
      if (!v.valid) return;
      const moves = legalMovesForGroup(state, v.ordered, v.axisIndex, state.turn, v.axisDir);
      const move = moves.find((m) => m.dirIndex === msg.dirIndex);
      if (!move) return;
      executeMove({ ordered: v.ordered, move }, true);
    } else if (msg.type === 'rematch') {
      matchToken++;
      aiThinking = false;
      moveAnimating = false;
      state = createInitialState();
      clearSelection();
      renderBoardState();
    }
  }

  // ---------- Choix de la palette de couleur des billes ----------
  const palettePicker = document.getElementById('abalone-palette-picker');
  function renderPalettePicker() {
    if (!palettePicker) return;
    palettePicker.innerHTML = '';
    Object.keys(MARBLE_PALETTES).forEach((id) => {
      const pal = MARBLE_PALETTES[id];
      const btn = document.createElement('button');
      btn.className = 'abalone-swatch' + (id === palette ? ' selected' : '');
      btn.setAttribute('aria-label', pal.label);
      btn.title = pal.label;
      const left = document.createElement('span');
      left.style.background = pal.swatch[0];
      const right = document.createElement('span');
      right.style.background = pal.swatch[1];
      btn.appendChild(left);
      btn.appendChild(right);
      btn.addEventListener('click', () => {
        if (palette === id) return;
        palette = id;
        savePalettePref(id);
        renderPalettePicker();
      });
      palettePicker.appendChild(btn);
    });
  }
  renderPalettePicker();

  document.getElementById('btn-abalone-local').addEventListener('click', () => startMatch('local'));
  document.getElementById('btn-abalone-rules').addEventListener('click', () => showScreen('screen-abalone-rules'));
  document.getElementById('btn-abalone-cancel').addEventListener('click', () => clearSelection());
  document.getElementById('btn-abalone-rematch').addEventListener('click', () => {
    if (mode === 'ai') humanOwner = Math.random() < 0.5 ? BLACK : WHITE;
    matchToken++;
    aiThinking = false;
    moveAnimating = false;
    state = createInitialState();
    clearSelection();
    buildBoard();
    renderBoardState();
    if (mode === 'online') net && net.send({ type: 'rematch' });
    maybeScheduleAiMove();
  });
  document.getElementById('btn-abalone-quit').addEventListener('click', () => {
    matchToken++;
    aiThinking = false;
    moveAnimating = false;
    if (net) { net.close(); net = null; }
    stopMusic();
    showScreen('screen-abalone-menu');
  });

  // ---------- Musique d'ambiance (préférence partagée avec Kamisado) ----------
  const btnAbaloneMusic = document.getElementById('btn-abalone-music');
  function updateAbaloneMusicButton() {
    if (btnAbaloneMusic) btnAbaloneMusic.textContent = isMusicPrefOn() ? '🔊' : '🔇';
  }
  updateAbaloneMusicButton();
  if (btnAbaloneMusic) {
    btnAbaloneMusic.addEventListener('click', () => {
      const next = !isMusicPrefOn();
      setMusicPref(next);
      updateAbaloneMusicButton();
      if (next) startMusic(); else stopMusic();
    });
  }

  // ---------- Mode IA ----------
  document.getElementById('btn-abalone-ai').addEventListener('click', () => showScreen('screen-abalone-ai-setup'));
  function startAbaloneAiGame(difficulty) {
    aiDifficulty = difficulty;
    // Camp tiré au hasard : BLACK commence toujours (règle du jeu), donc ce
    // tirage décide aussi qui joue le premier coup. L'affichage est
    // toujours retourné pour que l'humain se voie en bas.
    humanOwner = Math.random() < 0.5 ? BLACK : WHITE;
    startMatch('ai');
  }
  document.getElementById('btn-abalone-ai-facile').addEventListener('click', () => startAbaloneAiGame('facile'));
  document.getElementById('btn-abalone-ai-moyen').addEventListener('click', () => startAbaloneAiGame('moyen'));
  document.getElementById('btn-abalone-ai-difficile').addEventListener('click', () => startAbaloneAiGame('difficile'));

  // ---------- Mode en ligne ----------
  document.getElementById('btn-abalone-online').addEventListener('click', () => showScreen('screen-abalone-online-setup'));

  const abaloneHostOfferCode = document.getElementById('abalone-host-offer-code');
  const abaloneHostStatus = document.getElementById('abalone-host-status');

  document.getElementById('btn-abalone-host').addEventListener('click', async () => {
    document.getElementById('abalone-online-choice').classList.add('hidden');
    document.getElementById('abalone-host-panel').classList.remove('hidden');
    abaloneHostStatus.textContent = '';
    // Camp tiré au hasard : BLACK commence toujours (règle du jeu), donc ce
    // tirage décide aussi qui joue le premier coup. Chaque écran retourne
    // ensuite son propre affichage pour que chacun se voie en bas.
    myOwner = Math.random() < 0.5 ? BLACK : WHITE;

    net = new P2PConnection();
    net.onOpen = () => {
      abaloneHostStatus.textContent = 'Connecté ! Lancement de la partie…';
      net.send({ type: 'hello', ownerForYou: myOwner === BLACK ? WHITE : BLACK });
      setTimeout(() => startMatch('online'), 400);
    };
    net.onClose = () => {
      if (!document.getElementById('screen-abalone-game').classList.contains('active')) return;
      abaloneHostStatus.textContent = 'Connexion perdue.';
    };
    net.onMessage = (msg) => handleAbaloneNetMessage(msg);
    net.onError = (message) => { abaloneHostStatus.textContent = message; };

    abaloneHostOfferCode.textContent = 'Génération du code…';
    try {
      const code = await net.hostGame();
      abaloneHostOfferCode.textContent = code;
      abaloneHostStatus.textContent = "En attente de l'autre joueur…";
    } catch (e) {
      abaloneHostOfferCode.textContent = '—';
      abaloneHostStatus.textContent = 'Impossible de créer la partie. Vérifie ta connexion internet et réessaie.';
    }
  });

  document.getElementById('btn-abalone-share-offer').addEventListener('click', () => shareOrCopy(abaloneHostOfferCode.textContent));

  const abaloneJoinOfferInput = document.getElementById('abalone-join-offer-input');
  const abaloneJoinStatus = document.getElementById('abalone-join-status');

  document.getElementById('btn-abalone-join').addEventListener('click', () => {
    document.getElementById('abalone-online-choice').classList.add('hidden');
    document.getElementById('abalone-join-panel').classList.remove('hidden');
    abaloneJoinOfferInput.value = '';
    abaloneJoinStatus.textContent = '';
    // Le camp de l'invité est décidé par l'hôte et arrive avec le message 'hello'.
  });

  document.getElementById('btn-abalone-join-code').addEventListener('click', async () => {
    const code = abaloneJoinOfferInput.value.trim();
    if (!code) return;
    abaloneJoinStatus.textContent = 'Connexion en cours…';

    net = new P2PConnection();
    net.onOpen = () => {
      abaloneJoinStatus.textContent = 'Connecté ! En attente du lancement…';
    };
    net.onClose = () => {
      if (!document.getElementById('screen-abalone-game').classList.contains('active')) return;
      abaloneJoinStatus.textContent = 'Connexion perdue.';
    };
    net.onMessage = (msg) => handleAbaloneNetMessage(msg);
    net.onError = (message) => { abaloneJoinStatus.textContent = message; };

    try {
      await net.joinGame(code);
    } catch (e) {
      // le message lisible est déjà posé par onError ci-dessus
    }
  });

  // Les écrans en ligne repartent de zéro (choix host/rejoindre caché) à chaque retour.
  document.querySelectorAll('[id^="screen-abalone"] [data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      matchToken++;
      aiThinking = false;
      moveAnimating = false;
      if (net) { net.close(); net = null; }
      document.getElementById('abalone-online-choice').classList.remove('hidden');
      document.getElementById('abalone-host-panel').classList.add('hidden');
      document.getElementById('abalone-join-panel').classList.add('hidden');
      showScreen(btn.dataset.back);
    });
  });
}
