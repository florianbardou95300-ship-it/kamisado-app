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
 *   vers l'avant-gauche / avant-droite, d'autant de cases que l'on veut.
 * - Il n'y a aucune capture dans ce jeu : une tour ne peut ni sauter
 *   par-dessus une autre tour, ni se poser sur une case occupée — que
 *   ce soit une tour alliée ou adverse. Les tours servent uniquement
 *   à bloquer le passage, les 16 tours restent en jeu toute la partie.
 * - Après un coup, l'adversaire doit obligatoirement jouer la tour dont
 *   la couleur correspond à la case sur laquelle on vient de se poser.
 * - Si cette tour est bloquée (aucun coup légal), l'adversaire passe son
 *   tour : c'est à nouveau au joueur qui vient de bouger de jouer, avec
 *   la tour dont la couleur correspond à la case où se trouve la tour
 *   bloquée. Si cette tour de "réponse" est elle aussi bloquée, c'est un
 *   deadlock : le joueur qui vient de jouer perd la partie.
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
    loseReason: null, // null | 'deadlock' | 'reached-end'
    lastMove: null, // { from: [r,c], to: [r,c] }
    skipInfo: null, // { skippedOwner, stuckColor, responseColor } quand un tour a été passé
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

/** Liste des coups légaux pour la tour située en (r,c), sur un plateau `towers` donné. */
function legalMovesOn(towers, r, c) {
  const tower = towers[key(r, c)];
  if (!tower) return [];
  const moves = [];
  for (const [dr, dc] of directions(tower.owner)) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const occupant = towers[key(nr, nc)];
      if (occupant) break; // bloqué : aucune capture possible, qu'il soit allié ou adverse
      moves.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

export function legalMovesFrom(state, r, c) {
  return legalMovesOn(state.towers, r, c);
}

/** Trouve la position de la tour d'une couleur donnée pour un joueur. */
function findTower(towers, owner, color) {
  for (const k in towers) {
    const t = towers[k];
    if (t.owner === owner && t.color === color) {
      const [r, c] = k.split(',').map(Number);
      return [r, c];
    }
  }
  return null;
}

/**
 * Résout la tour qu'un joueur donné doit jouer pour une couleur imposée
 * donnée : sa position et ses coups légaux (éventuellement aucun).
 */
function resolveRequired(towers, owner, color) {
  const pos = findTower(towers, owner, color);
  if (!pos) return { row: null, col: null, moves: [] };
  const [row, col] = pos;
  return { row, col, moves: legalMovesOn(towers, row, col) };
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
      const moves = legalMovesOn(state.towers, r, c);
      if (moves.length > 0) result.push({ row: r, col: c, color: t.color, moves });
    }
    return result;
  }
  const { row, col, moves } = resolveRequired(state.towers, owner, state.requiredColor);
  return moves.length > 0 ? [{ row, col, color: state.requiredColor, moves }] : [];
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
  towers[key(toR, toC)] = tower; // la case d'arrivée est toujours vide (pas de capture)

  const mover = tower.owner;
  const opponent = mover === TOP ? BOTTOM : TOP;
  const homeRowForOpponentWin = mover === TOP ? 7 : 0;

  const lastMove = { from: [fromR, fromC], to: [toR, toC] };
  const history = [...state.history, { from: [fromR, fromC], to: [toR, toC], color: tower.color }];

  if (toR === homeRowForOpponentWin) {
    return {
      towers, turn: opponent, requiredColor: squareColor(toR, toC),
      winner: mover, loseReason: 'reached-end', lastMove, history, skipInfo: null,
    };
  }

  // Qui l'adversaire doit-il jouer, et peut-il effectivement le faire ?
  const landingColor = squareColor(toR, toC);
  const forced = resolveRequired(towers, opponent, landingColor);

  if (forced.moves.length > 0) {
    // Cas normal : l'adversaire a un coup légal avec la tour imposée.
    return {
      towers, turn: opponent, requiredColor: landingColor,
      winner: null, loseReason: null, lastMove, history, skipInfo: null,
    };
  }

  // La tour imposée à l'adversaire est bloquée : il passe son tour. Le
  // joueur qui vient de jouer rejoue, avec la tour dont la couleur
  // correspond à la case où se trouve actuellement la tour bloquée.
  const stuckSquareColor = squareColor(forced.row, forced.col);
  const response = resolveRequired(towers, mover, stuckSquareColor);
  const skipInfo = { skippedOwner: opponent, stuckColor: landingColor, responseColor: stuckSquareColor };

  if (response.moves.length > 0) {
    return {
      towers, turn: mover, requiredColor: stuckSquareColor,
      winner: null, loseReason: null, lastMove, history, skipInfo,
    };
  }

  // La tour de réponse est elle aussi bloquée : deadlock. Le joueur qui
  // vient de jouer (et dont la tour de réponse est bloquée) perd la partie.
  return {
    towers, turn: mover, requiredColor: stuckSquareColor,
    winner: opponent, loseReason: 'deadlock', lastMove, history, skipInfo,
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
