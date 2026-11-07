/**
 * Kamisado — moteur de règles (indépendant de l'UI et du réseau)
 *
 * Plateau 8x8, 8 couleurs. Chaque joueur possède 8 tours, une de chaque
 * couleur, placées sur sa rangée de départ (rangée 0 pour le joueur "haut",
 * rangée 7 pour le joueur "bas"), chaque tour étant posée sur la case de
 * même couleur qu'elle.
 *
 * Règles :
 * - Une tour se déplace en ligne droite vers l'avant, ou en diagonale
 *   vers l'avant-gauche / avant-droite, d'autant de cases que l'on veut,
 *   sans sauter par-dessus une autre tour.
 * - On peut capturer une tour adverse en se posant sur sa case (pas de
 *   prise par saut).
 * - Après un coup, l'adversaire doit obligatoirement jouer la tour dont
 *   la couleur correspond à la case sur laquelle on vient de se poser.
 * - Si cette tour ne peut faire aucun mouvement légal, le joueur qui doit
 *   la jouer perd immédiatement la partie (pas de "passe" en Kamisado).
 * - Le premier joueur à poser une tour sur la rangée de départ adverse
 *   gagne immédiatement.
 */

export const COLORS = ['orange', 'blue', 'purple', 'pink', 'yellow', 'red', 'green', 'brown'];

export const COLOR_HEX = {
  orange: '#e8833a',
  blue: '#3a6fe8',
  purple: '#8a3ae8',
  pink: '#e83ab0',
  yellow: '#e8d23a',
  red: '#d22e2e',
  green: '#2ea84a',
  brown: '#7a4a2e',
};

// Rangée 0 (haut) -> ... -> rangée 7 (bas). Symétrie à 180°.
const BOARD_LAYOUT = [
  ['orange', 'blue', 'purple', 'pink', 'yellow', 'red', 'green', 'brown'],
  ['red', 'orange', 'pink', 'green', 'blue', 'yellow', 'brown', 'purple'],
  ['green', 'pink', 'orange', 'red', 'purple', 'brown', 'yellow', 'blue'],
  ['pink', 'purple', 'blue', 'orange', 'brown', 'green', 'red', 'yellow'],
  ['yellow', 'red', 'green', 'brown', 'orange', 'blue', 'purple', 'pink'],
  ['blue', 'yellow', 'brown', 'purple', 'red', 'orange', 'pink', 'green'],
  ['purple', 'brown', 'yellow', 'blue', 'green', 'pink', 'orange', 'red'],
  ['brown', 'green', 'red', 'yellow', 'pink', 'purple', 'blue', 'orange'],
];

export const TOP = 'top';
export const BOTTOM = 'bottom';

export function squareColor(row, col) {
  return BOARD_LAYOUT[row][col];
}

export function createInitialState() {
  const towers = {}; // key "r,c" -> { owner, color }
  for (let col = 0; col < 8; col++) {
    const topColor = BOARD_LAYOUT[0][col];
    towers[`0,${col}`] = { owner: TOP, color: topColor };
    const bottomColor = BOARD_LAYOUT[7][col];
    towers[`7,${col}`] = { owner: BOTTOM, color: bottomColor };
  }
  return {
    towers,
    turn: BOTTOM, // le joueur du bas commence, coup libre
    requiredColor: null, // null = coup libre (premier coup de la partie)
    winner: null, // null | TOP | BOTTOM
    loseReason: null, // null | 'blocked' | 'reached-end'
    lastMove: null, // { from: [r,c], to: [r,c] }
    history: [],
  };
}

function key(r, c) {
  return `${r},${c}`;
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function forwardDir(owner) {
  // Le joueur du bas avance vers row décroissant, le joueur du haut vers row croissant.
  return owner === BOTTOM ? -1 : 1;
}

/** Les 3 directions de déplacement (vers l'avant) pour un propriétaire donné. */
function directions(owner) {
  const f = forwardDir(owner);
  return [
    [f, 0], // tout droit
    [f, -1], // diagonale gauche
    [f, 1], // diagonale droite
  ];
}

/** Liste des coups légaux pour la tour située en (r,c). */
export function legalMovesFrom(state, r, c) {
  const tower = state.towers[key(r, c)];
  if (!tower) return [];
  const moves = [];
  for (const [dr, dc] of directions(tower.owner)) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const occupant = state.towers[key(nr, nc)];
      if (occupant) {
        if (occupant.owner !== tower.owner) {
          moves.push([nr, nc]); // capture
        }
        break; // bloqué dans cette direction, qu'il y ait capture ou non
      }
      moves.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

/** Trouve la position de la tour d'une couleur donnée pour un joueur. */
function findTower(state, owner, color) {
  for (const k in state.towers) {
    const t = state.towers[k];
    if (t.owner === owner && t.color === color) {
      const [r, c] = k.split(',').map(Number);
      return [r, c];
    }
  }
  return null;
}

/** Toutes les tours qu'un joueur a le droit de jouer ce tour-ci, avec leurs coups. */
export function movableTowers(state) {
  if (state.winner) return [];
  const owner = state.turn;
  if (state.requiredColor === null) {
    // Coup libre : toutes les tours du joueur qui ont au moins un coup légal.
    const result = [];
    for (const k in state.towers) {
      const t = state.towers[k];
      if (t.owner !== owner) continue;
      const [r, c] = k.split(',').map(Number);
      const moves = legalMovesFrom(state, r, c);
      if (moves.length > 0) result.push({ row: r, col: c, color: t.color, moves });
    }
    return result;
  }
  const pos = findTower(state, owner, state.requiredColor);
  if (!pos) return [];
  const [r, c] = pos;
  const moves = legalMovesFrom(state, r, c);
  return moves.length > 0 ? [{ row: r, col: c, color: state.requiredColor, moves }] : [];
}

/**
 * Applique un coup. Retourne un nouvel état (ne mute pas l'état passé).
 * Lève une erreur si le coup n'est pas légal.
 */
export function applyMove(state, fromR, fromC, toR, toC) {
  const movable = movableTowers(state);
  const entry = movable.find((m) => m.row === fromR && m.col === fromC);
  if (!entry) throw new Error('Cette tour ne peut pas être jouée ce tour-ci.');
  const ok = entry.moves.some(([r, c]) => r === toR && c === toC);
  if (!ok) throw new Error('Coup illégal.');

  const towers = { ...state.towers };
  const tower = towers[key(fromR, fromC)];
  delete towers[key(fromR, fromC)];
  delete towers[key(toR, toC)]; // capture éventuelle
  towers[key(toR, toC)] = tower;

  const opponent = tower.owner === TOP ? BOTTOM : TOP;
  const homeRowForOpponentWin = tower.owner === TOP ? 7 : 0;

  let winner = null;
  let loseReason = null;

  if (toR === homeRowForOpponentWin) {
    winner = tower.owner;
    loseReason = 'reached-end';
  }

  let nextState = {
    towers,
    turn: opponent,
    requiredColor: squareColor(toR, toC),
    winner,
    loseReason,
    lastMove: { from: [fromR, fromC], to: [toR, toC] },
    history: [...state.history, { from: [fromR, fromC], to: [toR, toC], color: tower.color }],
  };

  // Si le joueur adverse n'a aucun coup légal possible avec la tour imposée,
  // il perd immédiatement (règle officielle : pas de passe en Kamisado).
  if (!winner) {
    const nextMovable = movableTowers(nextState);
    if (nextMovable.length === 0) {
      nextState = {
        ...nextState,
        winner: tower.owner,
        loseReason: 'blocked',
      };
    }
  }

  return nextState;
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
