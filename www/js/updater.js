/**
 * Mise à jour "à chaud" de l'appli : au lieu de renvoyer tout le monde
 * télécharger un nouvel APK sur GitHub, l'appli vérifie elle-même s'il
 * existe une version plus récente (en comparant au numéro de build
 * embarqué dans www/version.json) et, si oui, télécharge et applique
 * le nouveau contenu web directement depuis le dernier Release GitHub.
 *
 * Limite à connaître : ça ne met à jour que le code web (HTML/CSS/JS,
 * donc à peu près tout ce qu'on change ici). Si un jour on ajoute un
 * vrai plugin natif Android, il faudra repasser par un nouvel APK.
 */

const REPO = 'florianbardou95300-ship-it/kamisado-app';
const BUNDLE_ASSET_NAME = 'samourai-web-bundle.zip';

function getUpdaterPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater;
}

async function getCurrentVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return 0;
    const data = await res.json();
    return parseInt(data.version, 10) || 0;
  } catch (e) {
    return 0;
  }
}

async function getLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' });
  if (!res.ok) throw new Error('github-api-error');
  const data = await res.json();
  const match = /build-(\d+)/.exec(data.tag_name || '');
  const version = match ? parseInt(match[1], 10) : 0;
  const asset = (data.assets || []).find((a) => a.name === BUNDLE_ASSET_NAME);
  return { version, downloadUrl: asset ? asset.browser_download_url : null };
}

export function initUpdater() {
  const plugin = getUpdaterPlugin();
  // Obligatoire à chaque lancement : sinon le plugin considère que la
  // mise à jour précédente a échoué et revient en arrière tout seul.
  if (plugin) plugin.notifyAppReady().catch(() => {});

  const btn = document.getElementById('btn-update');
  const statusEl = document.getElementById('update-status');
  if (!btn) return;

  let pending = null; // { version, downloadUrl }

  (async () => {
    try {
      const [current, latest] = await Promise.all([getCurrentVersion(), getLatestRelease()]);
      if (latest.version > current && latest.downloadUrl) {
        pending = latest;
        btn.classList.remove('hidden');
      }
    } catch (e) {
      // Pas de connexion ou GitHub inaccessible : on ne dérange pas
      // l'utilisateur, il pourra réessayer plus tard.
    }
  })();

  btn.addEventListener('click', async () => {
    if (!pending) return;
    if (!plugin) {
      if (statusEl) statusEl.textContent = 'Mise à jour indisponible sur cet appareil.';
      return;
    }
    btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Téléchargement de la mise à jour…';
    try {
      const bundle = await plugin.download({
        url: pending.downloadUrl,
        version: String(pending.version),
      });
      if (statusEl) statusEl.textContent = 'Installation…';
      await plugin.set(bundle);
      // set() recharge l'appli avec le nouveau contenu ; si jamais il
      // ne le fait pas automatiquement sur cette version du plugin, on
      // force un rechargement pour être sûr.
      window.location.reload();
    } catch (e) {
      btn.disabled = false;
      if (statusEl) statusEl.textContent = 'Mise à jour impossible. Vérifie ta connexion et réessaie.';
    }
  });
}
