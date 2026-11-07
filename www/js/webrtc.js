/**
 * Connexion pair-à-pair sans serveur : signalisation manuelle (copier/coller
 * ou partage) d'un code contenant l'offre/réponse SDP une fois la collecte
 * ICE terminée ("vanilla ICE", pas de trickle). Aucun compte, aucun backend.
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function encode(desc) {
  const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
  return btoa(unescape(encodeURIComponent(json)));
}

function decode(code) {
  const json = decodeURIComponent(escape(atob(code.trim())));
  return JSON.parse(json);
}

export class P2PConnection {
  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.onMessage = null;
    this.onOpen = null;
    this.onClose = null;
    this.pc.addEventListener('connectionstatechange', () => {
      if (['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) {
        this.onClose && this.onClose(this.pc.connectionState);
      }
    });
  }

  _wireChannel(ch) {
    this.channel = ch;
    ch.addEventListener('open', () => this.onOpen && this.onOpen());
    ch.addEventListener('close', () => this.onClose && this.onClose('channel-closed'));
    ch.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.onMessage && this.onMessage(msg);
      } catch (err) {
        /* ignore malformed */
      }
    });
  }

  /** Côté hôte : crée l'offre. Retourne le code à transmettre. */
  async createOffer() {
    const ch = this.pc.createDataChannel('game');
    this._wireChannel(ch);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.pc);
    return encode(this.pc.localDescription);
  }

  /** Côté hôte : une fois reçu le code de réponse de l'invité. */
  async acceptAnswer(code) {
    const desc = decode(code);
    await this.pc.setRemoteDescription(desc);
  }

  /** Côté invité : à partir du code de l'hôte, retourne le code de réponse. */
  async createAnswer(offerCode) {
    const offer = decode(offerCode);
    const readyChannel = new Promise((resolve) => {
      this.pc.addEventListener('datachannel', (e) => {
        this._wireChannel(e.channel);
        resolve();
      });
    });
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.pc);
    await readyChannel;
    return encode(this.pc.localDescription);
  }

  send(msg) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(msg));
    }
  }

  close() {
    try { this.channel && this.channel.close(); } catch (e) {}
    try { this.pc.close(); } catch (e) {}
  }
}
