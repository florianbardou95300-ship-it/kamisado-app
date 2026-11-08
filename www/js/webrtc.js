/**
 * Connexion pair-à-pair pour le mode en ligne, via un code court (6
 * caractères) au lieu d'un gros bloc de texte à copier-coller.
 *
 * Techniquement, ça reste du WebRTC pair-à-pair pour la partie elle-même
 * (aucune donnée de jeu ne transite par un serveur) : seul le tout petit
 * "qui es-tu, où es-tu" initial passe par le serveur de signalisation
 * public et gratuit de PeerJS (0.peerjs.com), le temps d'établir la
 * connexion directe entre les deux téléphones. C'est le même principe
 * que "créer une salle" dans la plupart des jeux en ligne simples.
 *
 * Nécessite une connexion internet au moment de la mise en relation (pas
 * ensuite, pendant la partie — sauf si l'un des deux change de réseau).
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, pour éviter les confusions
const CODE_LENGTH = 6;
const PEERJS_ID_PREFIX = 'samourai-';

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class P2PConnection {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.onOpen = null;
    this.onClose = null;
    this.onMessage = null;
    this.onError = null; // (message lisible) appelé sur échec de connexion
  }

  _wireConnection(conn) {
    this.conn = conn;
    conn.on('open', () => this.onOpen && this.onOpen());
    conn.on('close', () => this.onClose && this.onClose('closed'));
    conn.on('error', () => this.onClose && this.onClose('error'));
    conn.on('data', (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        this.onMessage && this.onMessage(msg);
      } catch (e) { /* ignore message mal formé */ }
    });
  }

  /**
   * Crée une partie et retourne le code court à communiquer à l'autre
   * joueur. Se résout dès que le code est prêt (pas encore connecté —
   * `onOpen` sera appelé plus tard, quand l'autre joueur aura rejoint).
   */
  hostGame() {
    return new Promise((resolve, reject) => {
      const code = generateCode();
      const peer = new window.Peer(PEERJS_ID_PREFIX + code);
      this.peer = peer;

      peer.on('open', () => resolve(code));
      peer.on('connection', (conn) => this._wireConnection(conn));
      peer.on('error', (err) => {
        if (err && err.type === 'unavailable-id') {
          // Collision extrêmement improbable sur l'ID choisi : on retente.
          peer.destroy();
          this.hostGame().then(resolve, reject);
          return;
        }
        reject(err);
        this.onError && this.onError(readableError(err));
      });
      peer.on('disconnected', () => this.onClose && this.onClose('disconnected'));
    });
  }

  /** Rejoint une partie à partir du code donné par l'hôte. */
  joinGame(code) {
    return new Promise((resolve, reject) => {
      const peer = new window.Peer();
      this.peer = peer;
      let settled = false;

      peer.on('open', () => {
        const conn = peer.connect(PEERJS_ID_PREFIX + code.trim().toUpperCase(), { reliable: true });
        this._wireConnection(conn);
        conn.on('open', () => {
          if (!settled) { settled = true; resolve(); }
        });
        conn.on('error', (err) => {
          if (!settled) { settled = true; reject(err); this.onError && this.onError(readableError(err)); }
        });
      });
      peer.on('error', (err) => {
        if (!settled) { settled = true; reject(err); this.onError && this.onError(readableError(err)); }
      });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      this.conn.send(JSON.stringify(msg));
    }
  }

  close() {
    try { this.conn && this.conn.close(); } catch (e) { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
  }
}

function readableError(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') return "Code introuvable. Vérifie qu'il est bien saisi et que l'autre joueur a bien créé la partie.";
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
    return 'Connexion impossible — vérifie ta connexion internet et réessaie.';
  }
  return 'Connexion impossible. Réessaie.';
}
