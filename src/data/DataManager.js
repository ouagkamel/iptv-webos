// src/data/DataManager.js — propriétaire unique des écritures IndexedDB.
//
// V18 import par défaut :
//   - bulkAdd exclusivement (un importId neuf rend les clés nouvelles) ;
//   - lots de 2 000 côté worker ;
//   - deux CHUNK en vol pour chevaucher mapping Worker et écriture IDB ;
//   - respiration UI une fois tous les quatre lots ;
//   - swap rapide puis garbage collection lazy de l'ancien import.
//
// La file de messages reste sérialisée : IndexedDB n'est jamais écrit par deux
// traitements concurrents. Le pipeline peut cependant avoir deux messages CHUNK
// déjà clonés/en attente pendant qu'un autre est écrit.
import { db } from './db.js';

const GC_BATCH_SIZE = 500;
const DEFAULT_YIELD_EVERY_CHUNKS = 4;
const MAX_YIELD_EVERY_CHUNKS = 16;

function isQuotaError(err, message) {
  return !!(err && err.name === 'QuotaExceededError') || /quota(?:exceeded| de stockage)/i.test(message);
}

export class DataManager {
  constructor(worker, targetTableDefault) {
    this.worker = worker;
    this.targetTableDefault = targetTableDefault || 'channels';
    this.processingQueue = Promise.resolve();
    this.abortedImports = new Set();
    this.auxListeners = [];
    this._rowsWritten = Object.create(null);
    this._chunksWritten = Object.create(null);
    this._gcTail = Promise.resolve();
    this._destroyed = false;
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
  }

  handleWorkerMessage(event) {
    const data = event.data;
    this.processingQueue = this.processingQueue.then(() => {
      if (this._destroyed) return undefined;
      if (data.type === 'CHUNK') return this._processChunk(data);
      if (data.type === 'COMPLETE') return this._processComplete(data);
      if (data.type === 'ERROR') {
        // Erreur terminale émise par le worker (ex. XTREAM_AUTH_FAILED).
        this.failImport(data.importId != null ? data.importId : null,
                        new Error(data.message || 'worker ERROR'));
        return undefined;
      }
      return this._routeAux(data);
    }).catch((err) => {
      this._handleTerminalError(err, data);
    });
  }

  _handleTerminalError(err, data) {
    this.failImport(data && data.importId != null ? data.importId : null, err);
  }

  /**
   * Voie terminale d'import unique. Elle ne rejette jamais : l'échec est
   * transformé en status failed + événement public, puis le staging est purgé
   * en petits lots pour ne pas bloquer encore la TV.
   */
  failImport(importId, err) {
    console.error('DataManager fatal:', err);
    if (importId == null) {
      window.dispatchEvent(new CustomEvent('worker-error', {
        detail: { message: String((err && err.message) || err) }
      }));
      return;
    }
    this.abortedImports.add(importId);
    try {
      this.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId });
    } catch (e1) { /* worker déjà mort : message orphelin toléré */ }
    const message = String((err && err.message) || err);
    const publicMessage = isQuotaError(err, message)
      ? 'STORAGE_QUOTA: quota de stockage local atteint ; les données actives sont conservées, relancez après nettoyage des imports échoués'
      : message;
    try {
      db.imports.update(importId, { status: 'failed', error: message })
        .catch((e2) => { console.error('DataManager: marquage failed impossible:', e2); });
    } catch (e3) { /* DB injoignable : déjà journalisé */ }
    this._purgeImportRows(importId).catch((ePurge) => {
      console.error('DataManager: purge staging après échec impossible:', ePurge);
    });
    window.dispatchEvent(new CustomEvent('import-error', {
      detail: { importId: importId, message: publicMessage }
    }));
  }

  /** Purge ciblée d'un staging, sans toucher à l'import actif d'une playlist. */
  async _purgeImportRows(importId) {
    const tables = [db.channels, db.vod, db.series, db.series_info, db.categories, db.epg];
    for (let i = 0; i < tables.length; i++) {
      await this._deleteImportRowsInBatches(tables[i], importId);
    }
  }

  addAuxListener(fn) {
    if (typeof fn === 'function') this.auxListeners.push(fn);
  }

  removeAuxListener(fn) {
    const i = this.auxListeners.indexOf(fn);
    if (i !== -1) this.auxListeners.splice(i, 1);
  }

  async _routeAux(data) {
    if (data && data.type === 'CATEGORIES') {
      // Attendre l'écriture des catégories avant de traiter COMPLETE. Le swap
      // peut ainsi être publié dès que le dernier message utile est effectivement
      // persistant, sans course entre catégorie et import-complete.
      return this._writeCategories(data);
    }
    if (data && data.type === 'IMPORT_META') {
      window.dispatchEvent(new CustomEvent('import-meta', { detail: {
        importId: data.importId, playlistId: data.playlistId, totalItems: data.totalItems
      } }));
    }
    if (data && data.type === 'IMPORT_PHASE') {
      window.dispatchEvent(new CustomEvent('import-phase', { detail: {
        importId: data.importId, playlistId: data.playlistId,
        phase: data.phase, label: data.label
      } }));
    }
    for (let i = 0; i < this.auxListeners.length; i++) {
      try { this.auxListeners[i](data); } catch (errAux) {
        console.error('DataManager aux listener:', errAux);
      }
    }
  }

  async _writeCategories(data) {
    if (this.abortedImports.has(data.importId)) return;
    try {
      const rows = (data.categories || []).map(function (c, i) {
        return { importId: data.importId, kind: data.kind, name: c.name, sort: i };
      });
      await db.transaction('rw', [db.categories], async () => {
        await db.categories.where('[importId+kind]').equals([data.importId, data.kind]).delete();
        if (rows.length > 0) await db.categories.bulkAdd(rows);
      });
    } catch (err) {
      // Les catégories sont auxiliaires : leur absence fait retomber l'UI sur
      // « Toutes », elle ne doit pas invalider le catalogue principal.
      console.error('DataManager: catégories non persistées:', err);
    }
  }

  async _processChunk({ importId, items, targetTable, chunkId, yieldEveryChunks }) {
    // PROT-5 : acquitter sans écrire si l'import a été avorté.
    if (this.abortedImports.has(importId)) {
      this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId: importId, chunkId: chunkId });
      return;
    }

    const table = db[targetTable || this.targetTableDefault];
    const rows = Array.isArray(items) ? items : [];
    if (!table) throw new Error('UNKNOWN_IMPORT_TABLE_' + targetTable);

    // bulkAdd est imposé pour tous les imports. Chaque ligne de staging porte un
    // importId neuf, donc sa clé est nouvelle ; aucune vérification de mise à jour
    // n'est nécessaire comme avec bulkPut.
    if (rows.length > 0) await table.bulkAdd(rows);

    this._rowsWritten[importId] = (this._rowsWritten[importId] || 0) + rows.length;
    window.dispatchEvent(new CustomEvent('import-rows', {
      detail: {
        importId: importId,
        written: this._rowsWritten[importId],
        targetTable: targetTable || this.targetTableDefault
      }
    }));

    this._chunksWritten[importId] = (this._chunksWritten[importId] || 0) + 1;
    const requestedEvery = parseInt(yieldEveryChunks, 10);
    const every = requestedEvery > 0
      ? Math.min(MAX_YIELD_EVERY_CHUNKS, requestedEvery)
      : DEFAULT_YIELD_EVERY_CHUNKS;
    if (this._chunksWritten[importId] % every === 0) await this._yieldToUi();

    this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId: importId, chunkId: chunkId });
  }

  /** Une seule frame, sans pause fixe par lot. Fallback sûr si rAF est suspendu. */
  _yieldToUi() {
    return new Promise(function (resolve) {
      const hidden = typeof document !== 'undefined' && document.hidden === true;
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
      if (hidden || !raf) {
        setTimeout(resolve, 0);
        return;
      }
      let done = false;
      let cap = null;
      const finish = function () {
        if (done) return;
        done = true;
        if (cap !== null) clearTimeout(cap);
        resolve();
      };
      // Le plafond n'est pas une attente voulue : il protège contre un rAF
      // suspendu par le moteur webOS malgré document.hidden=false.
      cap = setTimeout(finish, 32);
      raf(finish);
    });
  }

  async _processComplete({ playlistId, importId, kind }) {
    if (this.abortedImports.has(importId)) return;
    const isEpg = kind === 'epg';
    const activeField = isEpg ? 'activeEpgImportId' : 'activeImportId';

    // Transaction courte : le pointeur actif et le statut sont changés sans
    // supprimer l'ancien catalogue. L'ancien staging reste lisible par aucune
    // requête UI car toutes les lectures passent par activeImportId.
    const oldImportIds = await db.transaction('rw', [db.playlists, db.imports], async () => {
      const oldImports = await db.imports
        .where('playlistId').equals(playlistId)
        .and(i => i.id !== importId && i.kind === (isEpg ? 'epg' : 'playlist'))
        .primaryKeys();
      await db.playlists.update(playlistId,
        Object.assign({ updatedAt: Date.now() }, { [activeField]: importId }));
      await db.imports.update(importId, { status: 'completed' });
      return oldImports;
    });

    // L'UI peut afficher le catalogue immédiatement. La suppression des anciens
    // imports est volontairement hors de la transaction et différée d'une tâche.
    window.dispatchEvent(new CustomEvent('import-complete', {
      detail: { playlistId, importId, kind, oldImportIds: oldImportIds.slice() }
    }));
    this._scheduleGarbageCollection(playlistId, importId, kind, oldImportIds);
  }

  _scheduleGarbageCollection(playlistId, currentImportId, kind, oldImportIds) {
    if (!oldImportIds || oldImportIds.length === 0) return;
    const ids = oldImportIds.slice();
    const job = () => {
      if (this._destroyed) return Promise.resolve();
      return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
        if (this._destroyed) return undefined;
        return this._garbageCollectOldImports(playlistId, currentImportId, kind, ids);
      });
    };
    // Sérialiser les nettoyages évite que deux re-imports ouvrent simultanément
    // des transactions de suppression sur la même TV.
    this._gcTail = this._gcTail.then(job).catch((err) => {
      // Le prochain bootMaintenance purgera les lignes orphelines si la TV est
      // suspendue ou si le moteur refuse une suppression intermédiaire.
      console.error('DataManager: garbage collection différée:', err);
    });
  }

  async _garbageCollectOldImports(playlistId, currentImportId, kind, oldImportIds) {
    const playlist = await db.playlists.get(playlistId);
    const activeField = kind === 'epg' ? 'activeEpgImportId' : 'activeImportId';
    const activeId = playlist && playlist[activeField];
    const ids = oldImportIds.filter(function (id) {
      return id !== currentImportId && id !== activeId;
    });
    if (ids.length === 0) return;

    const tables = kind === 'epg'
      ? [db.epg]
      : [db.channels, db.vod, db.series, db.series_info, db.categories];
    for (let i = 0; i < ids.length; i++) {
      for (let t = 0; t < tables.length; t++) {
        await this._deleteImportRowsInBatches(tables[t], ids[i]);
      }
    }
    await db.imports.bulkDelete(ids);
  }

  async _deleteImportRowsInBatches(table, importId) {
    while (true) {
      const keys = await table.where('importId').equals(importId).primaryKeys();
      if (keys.length === 0) return;
      for (let i = 0; i < keys.length; i += GC_BATCH_SIZE) {
        await table.bulkDelete(keys.slice(i, i + GC_BATCH_SIZE));
        await this._yieldToUi();
      }
    }
  }

  /** Utile aux tests et au diagnostic : attend les GC déjà planifiées. */
  waitForGarbageCollection() {
    return this._gcTail;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.worker.onmessage = null;
    this.auxListeners = [];
  }
}
