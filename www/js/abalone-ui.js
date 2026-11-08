/**
 * Interface du jeu Abalone : rendu du plateau hexagonal en SVG,
 * sélection de groupes de billes, surbrillance des coups légaux,
 * exécution des coups. Mode local (2 joueurs, même téléphone) pour
 * cette première version.
 */
import {
  BLACK, WHITE, createInitialState, allCells, ownerAt,
  validateGroup, legalMovesForGroup, applyGroupMove,
} from './abalone.js';

const UNIT = 11; // espacement entre centres de cases voisines
const RADIUS_CELL = 4.6; // rayon d'une case / bille

const PLAYER_LABEL = { [BLACK]: 'Noir', [WHITE]: 'Blanc' };
const PLAYER_FILL = { [BLACK]: '#17101c', [WHITE]: '#f4ead8' };
const PLAYER_STROKE = { [BLACK]: '#000000', [WHITE]: '#b8a98a' };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function hexToPixel(q, r) {
  return { x: UNIT * (q + r / 2), y: UNIT * (r * Math.sqrt(3) / 2) };
}

export function initAbalone() {
  const svg = document.getElementById('board-abalone');
  const hudTurn = document.getElementById('abalone-hud-turn');
  const hudScore = document.getElementById('abalone-hud-score');
  const banner = document.getElementById('abalone-banner');
  const bannerText = document.getElementById('abalone-banner-text');

  const cells = allCells();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pixelByKey = new Map();
  for (const c of cells) {
    const p = hexToPixel(c.q, c.r);
    pixelByKey.set(`${c.q},${c.r}`, p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const margin = RADIUS_CELL * 1.6;
  const viewX = minX - margin, viewY = minY - margin;
  const viewW = (maxX - minX) + margin * 2, viewH = (maxY - minY) + margin * 2;
  svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);

  let state = null;
  let selected = []; // tableau de {q,r}, dans l'ordre de clic
  let currentMoves = []; // coups légaux pour la sélection actuelle

  function cellEl(q, r) { return svg.querySelector(`[data-cell="${q},${r}"]`); }

  function buildBoard() {
    svg.innerHTML = '';
    for (const c of cells) {
      const p = pixelByKey.get(`${c.q},${c.r}`);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-cell', `${c.q},${c.r}`);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);

      const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hole.setAttribute('r', RADIUS_CELL);
      hole.setAttribute('class', 'abalone-hole');
      g.appendChild(hole);

      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('r', RADIUS_CELL + 1.4);
      ring.setAttribute('class', 'abalone-highlight');
      ring.setAttribute('fill', 'none');
      g.appendChild(ring);

      const marble = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marble.setAttribute('r', RADIUS_CELL * 0.86);
      marble.setAttribute('class', 'abalone-marble');
      marble.setAttribute('visibility', 'hidden');
      g.appendChild(marble);

      g.addEventListener('click', () => onCellClick(c.q, c.r));
      svg.appendChild(g);
    }
  }

  function render() {
    for (const c of cells) {
      const g = cellEl(c.q, c.r);
      const owner = ownerAt(state, c.q, c.r);
      const marble = g.querySelector('.abalone-marble');
      const ring = g.querySelector('.abalone-highlight');
      if (owner) {
        marble.setAttribute('visibility', 'visible');
        marble.setAttribute('fill', PLAYER_FILL[owner]);
        marble.setAttribute('stroke', PLAYER_STROKE[owner]);
      } else {
        marble.setAttribute('visibility', 'hidden');
      }
      ring.setAttribute('stroke', 'none');
    }
    for (const c of selected) {
      cellEl(c.q, c.r).querySelector('.abalone-highlight').setAttribute('stroke', '#ffd27a');
    }
    for (const m of currentMoves) {
      const anchor = m.move.destCells[0];
      const ring = cellEl(anchor.q, anchor.r).querySelector('.abalone-highlight');
      ring.setAttribute('stroke', '#59d98e');
    }
    hudTurn.textContent = `Au tour de : ${PLAYER_LABEL[state.turn]}`;
    hudScore.textContent = `Sorties — Noir : ${state.score[BLACK]} · Blanc : ${state.score[WHITE]}`;
    if (state.winner) {
      banner.classList.remove('hidden');
      bannerText.textContent = `${PLAYER_LABEL[state.winner]} gagne ! (6 billes sorties)`;
    } else {
      banner.classList.add('hidden');
    }
  }

  function clearSelection() {
    selected = [];
    currentMoves = [];
    render();
  }

  function recomputeMoves() {
    if (selected.length === 0) { currentMoves = []; return; }
    const v = validateGroup(state, selected, state.turn);
    if (!v.valid) { currentMoves = []; return; }
    const moves = legalMovesForGroup(state, v.ordered, v.axisIndex, state.turn, v.axisDir);
    currentMoves = moves.map((move) => ({ ordered: v.ordered, move }));
  }

  function onCellClick(q, r) {
    if (state.winner) return;

    // Un coup en surbrillance est-il visé ?
    const hit = currentMoves.find((m) => m.move.destCells[0].q === q && m.move.destCells[0].r === r);
    if (hit) {
      state = applyGroupMove(state, hit.ordered, hit.move, state.turn);
      selected = [];
      currentMoves = [];
      render();
      return;
    }

    const owner = ownerAt(state, q, r);
    if (owner !== state.turn) {
      clearSelection();
      return;
    }

    const already = selected.some((c) => c.q === q && c.r === r);
    if (already) { clearSelection(); return; }

    const tentative = [...selected, { q, r }];
    const v = validateGroup(state, tentative, state.turn);
    if (v.valid) {
      selected = tentative;
    } else {
      selected = [{ q, r }];
    }
    recomputeMoves();
    render();
  }

  document.getElementById('btn-abalone-local').addEventListener('click', () => {
    state = createInitialState();
    selected = [];
    currentMoves = [];
    buildBoard();
    render();
    showScreen('screen-abalone-game');
  });
  document.getElementById('btn-abalone-rules').addEventListener('click', () => showScreen('screen-abalone-rules'));
  document.getElementById('btn-abalone-quit').addEventListener('click', () => showScreen('screen-abalone-menu'));
  document.getElementById('btn-abalone-cancel').addEventListener('click', () => clearSelection());
  document.getElementById('btn-abalone-rematch').addEventListener('click', () => {
    state = createInitialState();
    clearSelection();
    render();
  });
}
