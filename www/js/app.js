import {
  COLORS, COLOR_HEX, TOP, BOTTOM,
  createInitialState, squareColor, movableTowers, applyMove,
} from './kamisado.js';
import { P2PConnection } from './webrtc.js';

const COLOR_LABEL = {
  orange: 'Orange', blue: 'Bleu', purple: 'Violet', pink: 'Rose',
  yellow: 'Jaune', red: 'Rouge', green: 'Vert', brown: 'Marron',
};

// ---------- Navigation entre écrans ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (net) { net.close(); net = null; }
    showScreen(btn.dataset.back);
  });
});

// ---------- État de partie ----------
let state = null;
let mode = 'local'; // 'local' | 'online'
let myOwner = BOTTOM; // en ligne : le rôle du joueur local
let selected = null; // [r,c] sélectionné
let net = null; // P2PConnection en mode en ligne

const boardEl = document.getElementById('board');
const hudTurn = document.getElementById('hud-turn');
const hudRequired = document.getElementById('hud-required');
const hudConn = document.getElementById('hud-conn');
const banner = document.getElementById('banner');
const bannerText = document.getElementById('banner-text');

function startGame(newMode) {
  mode = newMode;
  state = createInitialState();
  selected = null;
  banner.classList.add('hidden');
  hudConn.textContent = mode === 'online' ? '🌐' : '';
  showScreen('screen-game');
  render();
}

function cellKey(r, c) { return `${r},${c}`; }

function render() {
  boardEl.innerHTML = '';
  const movable = state.winner ? [] : movableTowers(state);
  const canActNow = mode === 'local' || state.turn === myOwner;
  const movableMap = {};
  movable.forEach((m) => { movableMap[cellKey(m.row, m.col)] = m; });

  let highlightMoves = [];
  if (selected) {
    const sel = movableMap[cellKey(selected[0], selected[1])];
    if (sel) highlightMoves = sel.moves;
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.style.background = COLOR_HEX[squareColor(r, c)];
      cell.dataset.r = r;
      cell.dataset.c = c;

      if (state.lastMove) {
        const [lr, lc] = state.lastMove.to;
        if (lr === r && lc === c) cell.classList.add('last-move');
      }

      const isHighlighted = highlightMoves.some(([hr, hc]) => hr === r && hc === c);
      if (isHighlighted) {
        const occupied = state.towers[cellKey(r, c)];
        cell.classList.add(occupied ? 'highlight-capture' : 'highlight');
      }

      const tower = state.towers[cellKey(r, c)];
      if (tower) {
        const t = document.createElement('div');
        t.className = `tower owner-${tower.owner}`;
        t.style.background = COLOR_HEX[tower.color];
        if (selected && selected[0] === r && selected[1] === c) t.classList.add('selected');
        cell.appendChild(t);
      }

      if (canActNow) {
        cell.addEventListener('click', () => onCellClick(r, c, movableMap));
      }
      boardEl.appendChild(cell);
    }
  }

  if (state.winner) {
    hudTurn.textContent = state.winner === myOwner || mode === 'local'
      ? `${state.winner === TOP ? 'Haut' : 'Bas'} gagne !`
      : `${state.winner === TOP ? 'Haut' : 'Bas'} gagne !`;
    hudRequired.textContent = state.loseReason === 'blocked' ? 'Tour bloquée' : 'Ligne adverse atteinte';
    showBanner(state);
  } else {
    const turnLabel = mode === 'online'
      ? (state.turn === myOwner ? 'À toi de jouer' : "À l'adversaire")
      : `Tour : ${state.turn === TOP ? 'Haut' : 'Bas'}`;
    hudTurn.textContent = turnLabel;
    hudRequired.textContent = state.requiredColor
      ? `Tour imposée : ${COLOR_LABEL[state.requiredColor]}`
      : 'Premier coup : libre';
  }
}

function showBanner(finalState) {
  const winnerLabel = finalState.winner === TOP ? 'Joueur du haut' : 'Joueur du bas';
  const reason = finalState.loseReason === 'blocked'
    ? 'la tour imposée ne pouvait plus bouger.'
    : 'a atteint la rangée adverse.';
  bannerText.textContent = `${winnerLabel} gagne — ${reason}`;
  banner.classList.remove('hidden');
}

function onCellClick(r, c, movableMap) {
  if (state.winner) return;

  // Mode en ligne : on ne peut agir que si c'est bien notre tour.
  if (mode === 'online' && state.turn !== myOwner) return;

  const clickedMovable = movableMap[cellKey(r, c)];

  if (selected) {
    const [sr, sc] = selected;
    const selEntry = movableMap[cellKey(sr, sc)];
    const isValidTarget = selEntry && selEntry.moves.some(([mr, mc]) => mr === r && mc === c);
    if (isValidTarget) {
      performMove(sr, sc, r, c);
      selected = null;
      return;
    }
  }

  if (clickedMovable) {
    selected = (selected && selected[0] === r && selected[1] === c) ? null : [r, c];
    render();
  } else {
    selected = null;
    render();
  }
}

function performMove(fromR, fromC, toR, toC, fromRemote) {
  state = applyMove(state, fromR, fromC, toR, toC);
  render();
  if (mode === 'online' && !fromRemote) {
    net && net.send({ type: 'move', from: [fromR, fromC], to: [toR, toC] });
  }
}

document.getElementById('btn-rematch').addEventListener('click', () => {
  state = createInitialState();
  selected = null;
  banner.classList.add('hidden');
  render();
  if (mode === 'online') {
    net && net.send({ type: 'rematch' });
  }
});

document.getElementById('btn-quit').addEventListener('click', () => {
  if (net) { net.close(); net = null; }
  showScreen('screen-menu');
});

// ---------- Menu principal ----------
document.getElementById('btn-local').addEventListener('click', () => startGame('local'));
document.getElementById('btn-rules').addEventListener('click', () => showScreen('screen-rules'));
document.getElementById('btn-online').addEventListener('click', () => {
  showScreen('screen-online-setup');
  document.getElementById('online-choice').classList.remove('hidden');
  document.getElementById('host-panel').classList.add('hidden');
  document.getElementById('join-panel').classList.add('hidden');
});

// ---------- Mode en ligne : hôte ----------
const hostOfferCode = document.getElementById('host-offer-code');
const hostAnswerInput = document.getElementById('host-answer-input');
const hostStatus = document.getElementById('host-status');

document.getElementById('btn-host').addEventListener('click', async () => {
  document.getElementById('online-choice').classList.add('hidden');
  document.getElementById('host-panel').classList.remove('hidden');
  hostStatus.textContent = '';
  myOwner = BOTTOM; // l'hôte joue en bas, et commence la partie

  net = new P2PConnection();
  net.onOpen = () => {
    hostStatus.textContent = 'Connecté ! Lancement de la partie…';
    net.send({ type: 'hello', ownerForYou: TOP });
    setTimeout(() => startGame('online'), 400);
  };
  net.onClose = () => {
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    hostStatus.textContent = 'Connexion perdue.';
  };
  net.onMessage = (msg) => handleNetMessage(msg);

  hostOfferCode.value = 'Génération du code…';
  const code = await net.createOffer();
  hostOfferCode.value = code;
});

document.getElementById('btn-share-offer').addEventListener('click', () => shareOrCopy(hostOfferCode.value));

document.getElementById('btn-connect-host').addEventListener('click', async () => {
  const code = hostAnswerInput.value.trim();
  if (!code) return;
  try {
    hostStatus.textContent = 'Connexion en cours…';
    await net.acceptAnswer(code);
  } catch (e) {
    hostStatus.textContent = 'Code invalide. Vérifie le copier-coller.';
  }
});

// ---------- Mode en ligne : invité ----------
const joinOfferInput = document.getElementById('join-offer-input');
const joinAnswerCode = document.getElementById('join-answer-code');
const joinStatus = document.getElementById('join-status');

document.getElementById('btn-join').addEventListener('click', () => {
  document.getElementById('online-choice').classList.add('hidden');
  document.getElementById('join-panel').classList.remove('hidden');
  joinStatus.textContent = '';
  myOwner = TOP; // l'invité joue en haut
});

document.getElementById('btn-generate-answer').addEventListener('click', async () => {
  const code = joinOfferInput.value.trim();
  if (!code) return;
  joinStatus.textContent = 'Génération de la réponse…';

  net = new P2PConnection();
  net.onOpen = () => {
    joinStatus.textContent = 'Connecté ! En attente du lancement…';
  };
  net.onClose = () => {
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    joinStatus.textContent = 'Connexion perdue.';
  };
  net.onMessage = (msg) => handleNetMessage(msg);

  try {
    const answer = await net.createAnswer(code);
    joinAnswerCode.value = answer;
    document.getElementById('btn-share-answer').classList.remove('hidden');
    joinStatus.textContent = 'Envoie ce code à ton adversaire, puis attends.';
  } catch (e) {
    joinStatus.textContent = 'Code invalide. Vérifie le copier-coller.';
  }
});

document.getElementById('btn-share-answer').addEventListener('click', () => shareOrCopy(joinAnswerCode.value));

function handleNetMessage(msg) {
  if (msg.type === 'hello') {
    startGame('online');
  } else if (msg.type === 'move') {
    performMove(msg.from[0], msg.from[1], msg.to[0], msg.to[1], true);
  } else if (msg.type === 'rematch') {
    state = createInitialState();
    selected = null;
    banner.classList.add('hidden');
    render();
  }
}

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
