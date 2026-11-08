/**
 * Adversaire "machine" pour le mode solo — aucun appel réseau ni LLM.
 * Un algorithme classique de jeu à deux : negamax + élagage alpha-bêta,
 * avec une fonction d'évaluation écrite à la main (progression vers la
 * ligne d'arrivée + mobilité — pas de matériel, ce jeu n'a pas de
 * capture). Approfondissement itératif avec un budget de temps selon
 * la difficulté choisie.
 */

import { TOP, BOTTOM, movableTowers, applyMove } from './kamisado.js';

const DIFFICULTIES = {
  facile: { maxDepth: 2, timeBudgetMs: 150, noise: 35 },
  moyen: { maxDepth: 4, timeBudgetMs: 450, noise: 8 },
  difficile: { maxDepth: 8, timeBudgetMs: 1200, noise: 0 },
};

const WIN_SCORE = 1_000_000;

function flattenMoves(state) {
  const moves = [];
  for (const entry of movableTowers(state)) {
    for (const to of entry.moves) {
      moves.push({ from: [entry.row, entry.col], to });
    }
  }
  return moves;
}

/**
 * Trie les coups pour un meilleur élagage alpha-bêta : on explore d'abord
 * ceux qui avancent le plus (heuristique simple, pas de prises possibles
 * dans ce jeu — les tours ne font que bloquer le passage).
 */
function orderMoves(state, moves) {
  return [...moves].sort((a, b) => {
    const da = Math.abs(a.to[0] - a.from[0]);
    const db = Math.abs(b.to[0] - b.from[0]);
    return db - da;
  });
}

/** Score du point de vue du joueur qui doit jouer (state.turn). Positif = bon pour lui. */
function evaluate(state) {
  let top = 0;
  let bottom = 0;
  for (const k in state.towers) {
    const t = state.towers[k];
    const row = Number(k.split(',')[0]);
    if (t.owner === TOP) {
      top += row * 12; // progression vers la rangée 7
    } else {
      bottom += (7 - row) * 12; // progression vers la rangée 0
    }
  }
  const base = state.turn === TOP ? top - bottom : bottom - top;
  const mobility = flattenMoves(state).length * 2;
  return base + mobility;
}

function negamax(state, depth, alpha, beta, deadline) {
  if (state.winner) {
    // state.winner est toujours le joueur qui vient de jouer : state.turn a donc perdu.
    return -WIN_SCORE - depth;
  }
  if (depth === 0 || Date.now() > deadline) {
    return evaluate(state);
  }
  const moves = orderMoves(state, flattenMoves(state));
  let best = -Infinity;
  for (const { from, to } of moves) {
    const child = applyMove(state, from[0], from[1], to[0], to[1]);
    const score = -negamax(child, depth - 1, -beta, -alpha, deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Choisit un coup pour le joueur `state.turn`.
 * `difficulty` : 'facile' | 'moyen' | 'difficile'
 */
export function chooseAiMove(state, difficulty) {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.moyen;
  let rootMoves = orderMoves(state, flattenMoves(state));
  if (rootMoves.length === 0) return null;

  // Niveau "facile" : on évite les coups spectaculaires à longue portée
  // tant qu'une autre option existe, pour un jeu plus simple à lire et
  // à battre pour un débutant.
  if (difficulty === 'facile') {
    const short = rootMoves.filter((m) => Math.abs(m.to[0] - m.from[0]) <= 3);
    if (short.length > 0) rootMoves = short;
  }
  if (rootMoves.length === 1) return rootMoves[0];

  const start = Date.now();
  const deadline = start + cfg.timeBudgetMs;
  let bestMove = rootMoves[0];

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    let depthBestMove = null;
    let depthBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of rootMoves) {
      const child = applyMove(state, move.from[0], move.from[1], move.to[0], move.to[1]);
      let score = -negamax(child, depth - 1, -beta, -alpha, deadline);
      if (cfg.noise > 0) score += (Math.random() - 0.5) * cfg.noise;
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = move;
      }
      if (score > alpha) alpha = score;
    }

    if (depthBestMove) bestMove = depthBestMove;
    if (Date.now() > deadline) break;
  }

  return bestMove;
}

export { DIFFICULTIES };
