// src/utils/CapabilityDetector.js — spec §3 (corrigé V9.1 au build Sprint 0).
// webostvjs@1.2.4 (webOSTV.js) n'exporte RIEN en ESM : c'est un bundle webpack qui
// attache window.webOS par effet de bord (vérifié dans node_modules au build).
// Un `import webOS from 'webostvjs'` échoue au bundling Rollup ("no default export")
// → import pur effet de bord + accès window.webOS. Le double chemin npm/global du
// texte V8 se réduit donc au chemin global, ce que le paquet impose réellement.
// Détection webOS via SDK (deviceInfo.sdkVersion), JAMAIS via l'UA. Timeout 1000 ms.
import 'webostvjs';

export const Capabilities = {
  hasWorker: typeof Worker !== 'undefined',
  hasFetch: typeof fetch === 'function',
  hasReadableStream: typeof ReadableStream !== 'undefined',
  hasTextDecoder: typeof TextDecoder !== 'undefined',
  hasIndexedDB: typeof indexedDB !== 'undefined',
  hasMSE: typeof window.MediaSource !== 'undefined' && typeof window.SourceBuffer !== 'undefined',

  async detectAll() {
    if (!this.hasIndexedDB || !this.hasWorker) {
      throw new Error('BLOCKING: Environnement webOS non conforme (IndexedDB ou Worker manquant).');
    }

    const baselineVersion = { major: 5, minor: 0, patch: 0 };
    const baselineModel = '';

    const fetchDeviceInfo = new Promise((resolve) => {
      const sdkObj = (typeof window !== 'undefined' && window.webOS) ? window.webOS : null;
      if (sdkObj && typeof sdkObj.deviceInfo === 'function') {
        sdkObj.deviceInfo((info) => {
          if (info && info.sdkVersion) {
            const parts = String(info.sdkVersion).split('.').map(n => parseInt(n, 10) || 0);
            resolve({
              version: { major: parts[0] || 5, minor: parts[1] || 0, patch: parts[2] || 0 },
              modelName: info.modelName || ''
            });
          } else {
            resolve({ version: baselineVersion, modelName: baselineModel });
          }
        });
      } else {
        resolve({ version: baselineVersion, modelName: baselineModel });
      }
    });

    // Jamais de bootstrap figé : si le SDK ne répond pas (dev browser, émulateur), baseline 5.0
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ version: baselineVersion, modelName: baselineModel }), 1000)
    );

    const device = await Promise.race([fetchDeviceInfo, timeout]);
    return this._buildCapabilityReport(device);
  },

  _buildCapabilityReport(device) {
    return {
      webosVersion: device.version,          // Tuple {major, minor, patch} : comparaison par major
      modelName: device.modelName,           // Alimente l'allowlist Dual Player (§7.5)
      canStreamFetch: this.hasFetch && this.hasReadableStream && this.hasTextDecoder,
      canUseMSE: this.hasMSE,
      isWebOS6OrHigher: device.version.major >= 6
    };
  }
};
