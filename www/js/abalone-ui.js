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
  validateGroup, legalMovesForGroup, applyGroupMove,
} from './abalone.js';
import { playAbaloneMoveSound, playAbaloneCaptureSound } from './audio.js';
import { chooseAbaloneAiMove } from './abalone-ai.js';
import { P2PConnection } from './webrtc.js';

const UNIT = 11; // espacement entre centres de cases voisines
const RADIUS_CELL = 4.6; // rayon d'une case / bille
// Doit dépasser UNIT/2 (le point où nearestCell bascule vers la case suivante),
// sinon le geste abandonne la sélection juste avant d'atteindre cette case.
const MIN_DRAG = UNIT * 0.58; // distance avant de considérer que le doigt quitte la ligne
const MAX_PREVIEW_OFFSET = UNIT * 0.62; // décalage visuel max pendant le glissement
const AIM_COS_TOLERANCE = Math.cos(40 * Math.PI / 180);

const PLAYER_LABEL = { [BLACK]: 'Noir', [WHITE]: 'Blanc' };

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
  let phase = 'idle'; // 'idle' | 'selecting' | 'moving'
  let dragStart = null;
  let aimedMove = null;
  let capsuleEl = null;

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

  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const m = svg.getScreenCTM().inverse();
    const p = pt.matrixTransform(m);
    return { x: p.x, y: p.y };
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
    grad('marbleBlack', [['0%', '#75757f'], ['28%', '#2c2c35'], ['70%', '#0c0c11'], ['100%', '#000000']]);
    grad('marbleWhite', [['0%', '#ffffff'], ['35%', '#f6ecdb'], ['75%', '#dcccab'], ['100%', '#b8a98a']]);
    svg.appendChild(defs);
  }

  function buildBoard() {
    svg.innerHTML = '';
    buildDefs();
    const svgns = 'http://www.w3.org/2000/svg';
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
      glint.setAttribute('transform', 'rotate(-35)');
      glint.setAttribute('visibility', 'hidden');
      g.appendChild(glint);

      svg.appendChild(g);
    }

    capsuleEl = document.createElementNS(svgns, 'line');
    capsuleEl.setAttribute('class', 'abalone-selection');
    capsuleEl.setAttribute('stroke-linecap', 'round');
    capsuleEl.setAttribute('visibility', 'hidden');
    svg.appendChild(capsuleEl);

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
      hudTurn.textContent = `Au tour de : ${PLAYER_LABEL[state.turn]}`;
    }
    if (trayBlack) renderTray(trayBlack, state.score[BLACK]);
    if (trayWhite) renderTray(trayWhite, state.score[WHITE]);
    if (state.winner) {
      banner.classList.remove('hidden');
      bannerText.textContent = `${PLAYER_LABEL[state.winner]} gagne ! (6 billes sorties)`;
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
    selected = [];
    currentMoves = [];
    phase = 'idle';
    aimedMove = null;
    renderCapsule(null, null);
  }

  function finishGesture(executed) {
    if (!executed) {
      resetGroupOffset();
      renderCapsule(null, null);
    }
    phase = 'idle';
    dragStart = null;
    aimedMove = null;
  }

  function executeMove(picked, fromRemote) {
    const capture = picked.move.capture;
    const mover = state.turn;
    state = applyGroupMove(state, picked.ordered, picked.move, mover);
    selected = [];
    currentMoves = [];
    renderBoardState();
    renderCapsule(null, null);
    if (capture) playAbaloneCaptureSound(); else playAbaloneMoveSound();

    if (mode === 'online' && !fromRemote && net) {
      net.send({
        type: 'move',
        group: picked.ordered.map((c) => ({ q: c.q, r: c.r })),
        dirIndex: picked.move.dirIndex,
      });
    }
    if (!fromRemote) maybeScheduleAiMove();
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
    if (!state || state.winner || aiThinking) return false;
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
        phase = 'moving';
        dragStart = p;
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
    state = createInitialState();
    selected = []; currentMoves = []; phase = 'idle'; aimedMove = null;
    if (hudConn) hudConn.textContent = mode === 'online' ? '🌐' : mode === 'ai' ? '🤖' : '';
    buildBoard();
    renderBoardState();
    showScreen('screen-abalone-game');
    maybeScheduleAiMove();
  }

  function handleAbaloneNetMessage(msg) {
    if (msg.type === 'hello') {
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
      state = createInitialState();
      clearSelection();
      renderBoardState();
    }
  }

  document.getElementById('btn-abalone-local').addEventListener('click', () => startMatch('local'));
  document.getElementById('btn-abalone-rules').addEventListener('click', () => showScreen('screen-abalone-rules'));
  document.getElementById('btn-abalone-cancel').addEventListener('click', () => clearSelection());
  document.getElementById('btn-abalone-rematch').addEventListener('click', () => {
    matchToken++;
    aiThinking = false;
    state = createInitialState();
    clearSelection();
    renderBoardState();
    if (mode === 'online') net && net.send({ type: 'rematch' });
    maybeScheduleAiMove();
  });
  document.getElementById('btn-abalone-quit').addEventListener('click', () => {
    matchToken++;
    aiThinking = false;
    if (net) { net.close(); net = null; }
    showScreen('screen-abalone-menu');
  });

  // ---------- Mode IA ----------
  document.getElementById('btn-abalone-ai').addEventListener('click', () => showScreen('screen-abalone-ai-setup'));
  function startAbaloneAiGame(difficulty) {
    aiDifficulty = difficulty;
    humanOwner = BLACK; // l'humain joue toujours en noir, et commence
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
    myOwner = BLACK; // l'hôte joue en noir, et commence la partie

    net = new P2PConnection();
    net.onOpen = () => {
      abaloneHostStatus.textContent = 'Connecté ! Lancement de la partie…';
      net.send({ type: 'hello', ownerForYou: WHITE });
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
    myOwner = WHITE; // l'invité joue en blanc
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
      if (net) { net.close(); net = null; }
      document.getElementById('abalone-online-choice').classList.remove('hidden');
      document.getElementById('abalone-host-panel').classList.add('hidden');
      document.getElementById('abalone-join-panel').classList.add('hidden');
      showScreen(btn.dataset.back);
    });
  });
}
