/**
 * Adversaire "machine" pour Abalone — negamax + élagage alpha-bêta,
 * approfondissement itératif avec un budget de temps selon la
 * difficulté (même principe que l'IA de Kamisado dans ai.js).
 *
 * Évaluation à la main : marbles restantes, billes sorties (le plus
 * important — gagner à 6), contrôle du centre, exposition au bord.
 */

import {
  RADIUS, allCells, ownerAt, hexDistance, otherOwner, allLegalMoves, applyGroupMove,
} from './abalone.js';

const DIFFICULTIES = {
  facile: { maxDepth: 2, timeBudgetMs: 350, noise: 400 },
  moyen: { maxDepth: 3, timeBudgetMs: 800, noise: 120 },
  difficile: { maxDepth: 4, timeBudgetMs: 1800, noise: 0 },
};

const WIN_SCORE = 1_000_000;

/** Trie les coups pour un meilleur élagage : captures d'abord. */
function orderMoves(moves) {
  return [...moves].sort((a, b) => (b.move.capture ? 1 : 0) - (a.move.capture ? 1 : 0));
}

/** Score du point de vue du joueur qui doit jouer (state.turn). Positif = bon pour lui. */
function evaluate(state) {
  const me = state.turn;
  const opp = otherOwner(me);
  let myCount = 0, oppCount = 0, myCenter = 0, oppCenter = 0, myEdge = 0, oppEdge = 0;

  for (const c of allCells()) {
    const o = ownerAt(state, c.q, c.r);
    if (!o) continue;
    const d = hexDistance(c.q, c.r);
    const centerWeight = RADIUS + 1 - d;
    if (o === me) {
      myCount++;
      myCenter += centerWeight;
      if (d === RADIUS) myEdge++;
    } else {
      oppCount++;
      oppCenter += centerWeight;
      if (d === RADIUS) oppEdge++;
    }
  }

  const scoreDiff = (state.score[me] - state.score[opp]) * 6000;
  const material = (myCount - oppCount) * 120;
  const center = (myCenter - oppCenter) * 8;
  const edgeSafety = (oppEdge - myEdge) * 10;
  return scoreDiff + material + center + edgeSafety;
}

function negamax(state, depth, alpha, beta, deadline) {
  if (state.winner) {
    // state.winner est toujours le joueur qui vient de jouer : state.turn a donc perdu.
    return -WIN_SCORE - depth;
  }
  if (depth === 0 || Date.now() > deadline) {
    return evaluate(state);
  }
  const moves = orderMoves(allLegalMoves(state, state.turn));
  if (moves.length === 0) return evaluate(state);

  let best = -Infinity;
  for (const { ordered, move } of moves) {
    const child = applyGroupMove(state, ordered, move, state.turn);
    const score = -negamax(child, depth - 1, -beta, -alpha, deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Choisit un coup pour le joueur `state.turn`. Renvoie { ordered, move }
 * (directement réutilisable avec applyGroupMove), ou null si aucun coup.
 */
export function chooseAbaloneAiMove(state, difficulty) {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.moyen;
  const rootMoves = orderMoves(allLegalMoves(state, state.turn));
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return rootMoves[0];

  const start = Date.now();
  const deadline = start + cfg.timeBudgetMs;
  let bestEntry = rootMoves[0];

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    let depthBest = null;
    let depthBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const entry of rootMoves) {
      const child = applyGroupMove(state, entry.ordered, entry.move, state.turn);
      let score = -negamax(child, depth - 1, -beta, -alpha, deadline);
      if (cfg.noise > 0) score += (Math.random() - 0.5) * cfg.noise;
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBest = entry;
      }
      if (score > alpha) alpha = score;
    }

    if (depthBest) bestEntry = depthBest;
    if (Date.now() > deadline) break;
  }

  return bestEntry;
}

export { DIFFICULTIES };
