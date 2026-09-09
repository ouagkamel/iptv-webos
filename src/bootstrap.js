// src/bootstrap.js — ordre opposable §3 : detectAll → ouverture Dexie → reprise de
// crash (§5.5) + rétention (§5.6) → filet worker.onerror + workerFactory (crash →
// paire recréée au prochain startImport) → init UI. Journalisation visible ares-inspect.
import { Capabilities } from './utils/CapabilityDetector.js';
import { db } from './data/db.js';
import { DataManager } from './data/DataManager.js';
import { ImportController } from './data/ImportController.js';
import { PlaylistManager } from './services/PlaylistManager.js';

import M3UWorker from './data/m3u.worker.js?worker';
import EpgWorker from './data/epg.worker.js?worker';
import XtreamWorker from './data/xtream.worker.js?worker';

const WORKER_KINDS = {
  playlist: { Ctor: M3UWorker,    targetTable: 'channels' },
  epg:      { Ctor: EpgWorker,    targetTable: 'epg' },
  xtream:   { Ctor: XtreamWorker, targetTable: 'channels' } // CHUNK porte targetTable par lot (§6.5)
};

/**
 * Registre de paires Worker + DataManager + ImportController, une par worker.
 * get(kind) crée à la demande ; après crash (worker.onerror), la paire est
 * détruite et recréée au prochain startImport (exigence §5.8 — filet + factory).
 */
export function createImportPairs() {
  const pairs = {};

  function get(kind) {
    if (!pairs[kind]) {
      const spec = WORKER_KINDS[kind];
      const worker = new spec.Ctor();
      const dataManager = new DataManager(worker, spec.targetTable);
      const controller = new ImportController(worker, dataManager);

      const pair = { kind: kind, worker: worker, dataManager: dataManager, controller: controller };
      pairs[kind] = pair;

      // Filet anti-crash §5.8 : ErrorEvent natif SANS importId → injection explicite.
      worker.onerror = function (ev) {
        const live = pairs[kind];
        if (live) {
          live.dataManager.failImport(live.controller.currentImportId, (ev && ev.error) || ev);
          try { live.worker.terminate(); } catch (eTerm) { /* déjà mort */ }
          live.dataManager.destroy();
          live.controller.destroy();
          pairs[kind] = null; // recréation à la prochaine demande
        }
      };

      // ACCOUNT_INFO (§6.5) : routage vers l'UI / DualPlayerPolicy par événement global.
      dataManager.addAuxListener(function (data) {
        if (data && data.type === 'ACCOUNT_INFO') {
          window.dispatchEvent(new CustomEvent('xtream-account-info', { detail: data }));
        }
      });
    }
    return pairs[kind];
  }

  return {
    get: get,
    destroyAll: function () {
      Object.keys(pairs).forEach(function (k) {
        const p = pairs[k];
        if (!p) return;
        try { p.controller.destroy(); } catch (e1) { /* noop */ }
        try { p.dataManager.destroy(); } catch (e2) { /* noop */ }
        try { p.worker.terminate(); } catch (e3) { /* noop */ }
        pairs[k] = null;
      });
    }
  };
}

export async function boot() {
  const t0 = Date.now();
  const capabilities = await Capabilities.detectAll();
  console.log('[boot] capabilities:', JSON.stringify(capabilities));

  await db.open();
  console.log('[boot] Dexie ouvert (v2 — table vod incluse, DB-5)');

  const pairs = createImportPairs();
  const manager = new PlaylistManager(pairs);

  await manager.bootMaintenance();
  console.log('[boot] maintenance §5.5/§5.6 effectuée en', Date.now() - t0, 'ms');

  return { capabilities: capabilities, db: db, pairs: pairs, manager: manager };
}
