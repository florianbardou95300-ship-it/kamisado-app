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
const CHECKSUM_ASSET_NAME = 'samourai-web-bundle.sha256';

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
  const assets = data.assets || [];
  const bundleAsset = assets.find((a) => a.name === BUNDLE_ASSET_NAME);
  const checksumAsset = assets.find((a) => a.name === CHECKSUM_ASSET_NAME);
  let checksum = '';
  if (checksumAsset) {
    // Le plugin de mise à jour exige un checksum SHA-256 du zip pour les
    // téléchargements "manuels" (sans backend dédié) : sans lui, il rejette
    // systématiquement avec "Checksum required".
    const checksumRes = await fetch(checksumAsset.browser_download_url, { cache: 'no-store' });
    if (checksumRes.ok) checksum = (await checksumRes.text()).trim();
  }
  return {
    version,
    downloadUrl: bundleAsset ? bundleAsset.browser_download_url : null,
    checksum,
  };
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
      const current = await getCurrentVersion();
      const latest = await getLatestRelease();
      if (latest.version > current && latest.downloadUrl && latest.checksum) {
        pending = latest;
        btn.classList.remove('hidden');
        if (statusEl) statusEl.textContent = '';
      } else if (statusEl) {
        // Diagnostic visible : utile pour vérifier que la vérification a
        // bien tourné et ce qu'elle a trouvé, sans gêner l'utilisateur
        // (le bouton reste caché s'il n'y a rien à faire).
        statusEl.textContent = `À jour (version ${current}).`;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = `Vérification impossible : ${e && e.message ? e.message : e}`;
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
        checksum: pending.checksum,
      });
      if (statusEl) statusEl.textContent = 'Installation…';
      await plugin.set({ id: bundle.id });
      // set() recharge l'appli avec le nouveau contenu ; si jamais il
      // ne le fait pas automatiquement sur cette version du plugin, on
      // force un rechargement pour être sûr.
      window.location.reload();
    } catch (e) {
      btn.disabled = false;
      if (statusEl) statusEl.textContent = `Mise à jour impossible : ${e && e.message ? e.message : e}`;
    }
  });
}
