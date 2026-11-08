/**
 * Moteur de règles d'Abalone — pur, indépendant de l'UI et du réseau.
 *
 * Plateau hexagonal de 61 cases, représenté en coordonnées axiales
 * (q, r) centrées sur (0,0), avec max(|q|, |r|, |q+r|) <= 4.
 *
 * But : pousser 6 billes adverses hors du plateau.
 * Un groupe de 1 à 3 billes alignées et contiguës se déplace :
 *  - en ligne (dans l'axe du groupe) : peut pousser des billes
 *    adverses si on est strictement plus nombreux qu'elles ;
 *  - en éventail (dans les autres directions) : seulement si toutes
 *    les cases d'arrivée sont vides.
 */

export const BLACK = 'black';
export const WHITE = 'white';

export const RADIUS = 4;

/** Distance (en cases) du centre du plateau. */
export function hexDistance(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

// 6 directions, en paires d'axes opposés : [0,3], [1,4], [2,5]
export const DIRECTIONS = [
  { q: 1, r: 0 },  // 0 : Est
  { q: 1, r: -1 }, // 1 : Nord-Est
  { q: 0, r: -1 }, // 2 : Nord-Ouest
  { q: -1, r: 0 }, // 3 : Ouest
  { q: -1, r: 1 }, // 4 : Sud-Ouest
  { q: 0, r: 1 },  // 5 : Sud-Est
];

export function cellKey(q, r) { return `${q},${r}`; }

export function inBounds(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= RADIUS;
}

export function neighbor(q, r, dirIndex) {
  const d = DIRECTIONS[dirIndex];
  return { q: q + d.q, r: r + d.r };
}

/** Renvoie l'index de direction (0-5) pointant de (q1,r1) vers (q2,r2), ou -1 si pas voisins. */
export function directionBetween(q1, r1, q2, r2) {
  const dq = q2 - q1, dr = r2 - r1;
  for (let i = 0; i < 6; i++) {
    if (DIRECTIONS[i].q === dq && DIRECTIONS[i].r === dr) return i;
  }
  return -1;
}

let _allCells = null;
/** Liste statique des 61 cases {q, r} du plateau. */
export function allCells() {
  if (_allCells) return _allCells;
  const cells = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    const qMin = Math.max(-RADIUS, -RADIUS - r);
    const qMax = Math.min(RADIUS, RADIUS - r);
    for (let q = qMin; q <= qMax; q++) cells.push({ q, r });
  }
  _allCells = cells;
  return cells;
}

export function otherOwner(owner) { return owner === BLACK ? WHITE : BLACK; }

export function createInitialState() {
  const cells = new Map(); // key -> owner

  // Noir : rangées r=-4 (pleine), r=-3 (pleine), r=-2 (3 du milieu)
  for (let q = 0; q <= 4; q++) cells.set(cellKey(q, -4), BLACK);
  for (let q = -1; q <= 4; q++) cells.set(cellKey(q, -3), BLACK);
  for (let q = 0; q <= 2; q++) cells.set(cellKey(q, -2), BLACK);

  // Blanc : symétrique par (q,r) -> (-q,-r)
  for (let q = -4; q <= 0; q++) cells.set(cellKey(q, 4), WHITE);
  for (let q = -4; q <= 1; q++) cells.set(cellKey(q, 3), WHITE);
  for (let q = -2; q <= 0; q++) cells.set(cellKey(q, 2), WHITE);

  return {
    cells,
    turn: BLACK,
    score: { [BLACK]: 0, [WHITE]: 0 }, // billes adverses sorties par ce joueur
    winner: null,
  };
}

export function ownerAt(state, q, r) {
  return state.cells.get(cellKey(q, r)) || null;
}

/**
 * Valide qu'un ensemble de 1 à 3 cases forme un groupe jouable : même
 * propriétaire, alignées sur un même axe, contiguës (sans trou).
 * `cellsArr` est un tableau de {q,r} dans un ordre quelconque.
 * Renvoie { valid, axisIndex, ordered } ou { valid: false }.
 */
export function validateGroup(state, cellsArr, owner) {
  if (cellsArr.length < 1 || cellsArr.length > 3) return { valid: false };
  for (const c of cellsArr) {
    if (ownerAt(state, c.q, c.r) !== owner) return { valid: false };
  }
  if (cellsArr.length === 1) return { valid: true, axisIndex: null, ordered: cellsArr.slice() };

  // Trouve une direction reliant deux des cases.
  const [a, b] = cellsArr;
  const dir = directionBetween(a.q, a.r, b.q, b.r);
  const revDir = directionBetween(b.q, b.r, a.q, a.r);
  if (dir === -1 && revDir === -1) return { valid: false };
  const axisDir = dir !== -1 ? dir : revDir;
  const start = dir !== -1 ? a : b;

  // Construit la ligne attendue à partir de `start` dans la direction axisDir
  // et vérifie que cellsArr correspond exactement (même taille, contigu).
  const ordered = [start];
  let cur = start;
  for (let i = 1; i < cellsArr.length; i++) {
    cur = neighbor(cur.q, cur.r, axisDir);
    const found = cellsArr.find((c) => c.q === cur.q && c.r === cur.r);
    if (!found) return { valid: false };
    ordered.push(cur);
  }
  if (ordered.length !== cellsArr.length) return { valid: false };

  const axisIndex = axisDir % 3; // 0,1,2 : les 3 axes (direction ou son opposé)
  return { valid: true, axisIndex, ordered, axisDir };
}

/**
 * Pour un groupe validé, calcule les coups légaux dans les 6 directions.
 * Renvoie un tableau de { dirIndex, type: 'inline'|'broadside', destCells,
 * capture } — destCells = nouvelles positions du groupe (dans le même
 * ordre que `ordered`), capture = true si une bille adverse est éjectée.
 */
export function legalMovesForGroup(state, ordered, axisIndex, owner, axisDir) {
  const moves = [];
  const size = ordered.length;

  for (let dirIndex = 0; dirIndex < 6; dirIndex++) {
    const isInline = size > 1 && dirIndex % 3 === axisIndex;

    if (isInline) {
      // `ordered` est construit en avançant dans la direction `axisDir`.
      // Le marbre de tête (celui qui "ouvre la voie") dépend donc du sens.
      const forward = dirIndex === axisDir ? ordered[ordered.length - 1] : ordered[0];
      const front0 = neighbor(forward.q, forward.r, dirIndex);
      // Bloqué par une bille de son propre camp (hors du groupe) : aucun coup possible.
      const blockedByOwn = inBounds(front0.q, front0.r) && ownerAt(state, front0.q, front0.r) === owner;
      if (!blockedByOwn) {
        let front = front0;
        let defenderCount = 0;
        const opponent = otherOwner(owner);
        const path = [];
        while (inBounds(front.q, front.r) && ownerAt(state, front.q, front.r) === opponent) {
          path.push({ ...front });
          defenderCount++;
          front = neighbor(front.q, front.r, dirIndex);
        }
        if (defenderCount === 0) {
          // La case d'arrivée (front0) doit être sur le plateau : on ne peut
          // pas faire avancer son propre groupe hors des limites.
          if (inBounds(front0.q, front0.r)) {
            moves.push({ dirIndex, type: 'inline', destCells: ordered.map((c) => neighbor(c.q, c.r, dirIndex)), capture: false });
          }
        } else if (defenderCount < size) {
          const afterLast = front; // déjà avancé d'un cran après le dernier adversaire
          const capture = !inBounds(afterLast.q, afterLast.r);
          const landingFree = capture || ownerAt(state, afterLast.q, afterLast.r) === null;
          if (landingFree) {
            moves.push({ dirIndex, type: 'inline', destCells: ordered.map((c) => neighbor(c.q, c.r, dirIndex)), capture, pushedCells: path });
          }
        }
      }
    } else {
      // Éventail (ou déplacement simple pour un groupe de taille 1) : toutes les cases d'arrivée doivent être vides.
      const dest = ordered.map((c) => neighbor(c.q, c.r, dirIndex));
      const allFree = dest.every((c) => inBounds(c.q, c.r) && ownerAt(state, c.q, c.r) === null);
      if (allFree) moves.push({ dirIndex, type: 'broadside', destCells: dest, capture: false });
    }
  }
  return moves;
}

/** Applique un coup choisi (issu de legalMovesForGroup) et renvoie le nouvel état. */
export function applyGroupMove(state, ordered, move, owner) {
  const cells = new Map(state.cells);
  for (const c of ordered) cells.delete(cellKey(c.q, c.r));
  if (move.pushedCells) {
    for (const c of move.pushedCells) cells.delete(cellKey(c.q, c.r));
    // Replace les billes poussées une case plus loin dans la même direction, si encore sur le plateau.
    for (const c of move.pushedCells) {
      const moved = neighbor(c.q, c.r, move.dirIndex);
      if (inBounds(moved.q, moved.r)) cells.set(cellKey(moved.q, moved.r), otherOwner(owner));
    }
  }
  for (const c of move.destCells) cells.set(cellKey(c.q, c.r), owner);

  const score = { ...state.score };
  if (move.capture) score[owner] = score[owner] + 1;

  const winner = score[owner] >= 6 ? owner : null;
  return { cells, turn: otherOwner(owner), score, winner };
}

/**
 * Énumère tous les coups légaux pour `owner`, tous groupes possibles
 * (taille 1 à 3) confondus. Renvoie un tableau de { ordered, move },
 * directement réutilisable avec applyGroupMove. Utilisé par l'IA et
 * par la validation côté réseau.
 */
export function allLegalMoves(state, owner) {
  const results = [];
  const seen = new Set();

  function tryGroup(cellsArr) {
    const key = cellsArr.map((c) => cellKey(c.q, c.r)).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const v = validateGroup(state, cellsArr, owner);
    if (!v.valid) return;
    const moves = legalMovesForGroup(state, v.ordered, v.axisIndex, owner, v.axisDir);
    for (const move of moves) results.push({ ordered: v.ordered, move });
  }

  for (const c of allCells()) {
    if (ownerAt(state, c.q, c.r) !== owner) continue;
    tryGroup([c]);
    for (let dir = 0; dir < 3; dir++) {
      const n1 = neighbor(c.q, c.r, dir);
      if (ownerAt(state, n1.q, n1.r) !== owner) continue;
      tryGroup([c, n1]);
      const n2 = neighbor(n1.q, n1.r, dir);
      if (ownerAt(state, n2.q, n2.r) === owner) {
        tryGroup([c, n1, n2]);
      }
    }
  }
  return results;
}

/** Pour l'UI : cases occupées par `owner` adjacentes à (q,r) dans une direction donnée. */
export function sameOwnerNeighbor(state, q, r, owner, dirIndex) {
  const n = neighbor(q, r, dirIndex);
  return ownerAt(state, n.q, n.r) === owner ? n : null;
}
