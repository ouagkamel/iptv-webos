// src/data/DataManager.js — spec §5.3 (verbatim).
// File sérialisée, respiration UI compatible arrière-plan, voie terminale UNIQUE
// failImport (ne rejette jamais, §1.2-1), routage des signaux annexes.
import { db } from './db.js';

export class DataManager {
  constructor(worker, targetTableDefault) {
    this.worker = worker;
    this.targetTableDefault = targetTableDefault || 'channels';
    this.processingQueue = Promise.resolve();
    this.abortedImports = new Set();
    this.auxListeners = [];          // routage des signaux annexes (CHUNK_PARSED → §5.8)
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
        // Erreur terminale émise par le worker (ex. XTREAM_AUTH_FAILED §6.5)
        this.failImport(data.importId != null ? data.importId : null, new Error(data.message || 'worker ERROR'));
        return undefined;
      }
      this._routeAux(data); // CHUNK_PARSED / ACCOUNT_INFO et signaux annexes (§5.8, §6.5)
      return undefined;
    }).catch((err) => {
      this._handleTerminalError(err, data); // voie terminale UNIQUE — ne rejette jamais
    });
  }

  _handleTerminalError(err, data) {
    this.failImport(data && data.importId != null ? data.importId : null, err);
  }

  /**
   * Voie terminale d'import UNIQUE — appelée par le catch de la file ET par le
   * filet worker.onerror du bootstrap (qui injecte explicitement l'importId
   * courant, cf. §3 et §5.8). Ne rejette jamais : tout échec secondaire est
   * confiné localement (invariant §1.2-1).
   */
  failImport(importId, err) {
    console.error('DataManager fatal:', err);
    if (importId == null) {
      // Crash worker hors contexte d'import connu : journalisation via filet global
      window.dispatchEvent(new CustomEvent('worker-error', {
        detail: { message: String((err && err.message) || err) }
      }));
      return;
    }
    this.abortedImports.add(importId);
    try {
      this.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId });
    } catch (e1) { /* worker déjà mort (crash) : message orphelin toléré */ }
    try {
      db.imports.update(importId, { status: 'failed', error: String((err && err.message) || err) })
        .catch((e2) => { console.error('DataManager: marquage failed impossible:', e2); });
    } catch (e3) { /* DB injoignable (quota/corruption) : déjà journalisé */ }
    window.dispatchEvent(new CustomEvent('import-error', {
      detail: { importId: importId, message: String((err && err.message) || err) }
    }));
  }

  // Routage des signaux annexes vers le régulateur réseau (§5.8).
  // Le DataManager reste propriétaire unique de worker.onmessage.
  addAuxListener(fn) {
    if (typeof fn === 'function') this.auxListeners.push(fn);
  }

  removeAuxListener(fn) {
    const i = this.auxListeners.indexOf(fn);
    if (i !== -1) this.auxListeners.splice(i, 1);
  }

  _routeAux(data) {
    for (let i = 0; i < this.auxListeners.length; i++) {
      try { this.auxListeners[i](data); } catch (errAux) { console.error('DataManager aux listener:', errAux); }
    }
  }

  async _processChunk({ importId, items, targetTable }) {
    // PROT-5 : acquitter sans écrire si l'import a été avorté
    if (this.abortedImports.has(importId)) {
      this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId });
      return;
    }

    await db[targetTable || this.targetTableDefault].bulkPut(items);

    // Respiration UI compatible arrière-plan :
    // rAF est suspendu par webOS quand document.hidden === true → setTimeout obligatoire,
    // sinon l'import se fige jusqu'au retour au premier plan.
    // Correction V9.1 (découverte au harnais headless, utile aussi en TV sous VPU
    // saturé ou rAF starvé) : la respiration est un RACE rAF / plafond 32 ms — le
    // rendu suit le rythme des frames quand il y en a, mais l'import n'est jamais
    // bloqué indéfiniment par une frame absente. Borne d'attente renforcée, sens
    // opposé à tout risque de régression des 60 FPS (§11-T3).
    await new Promise(resolve => {
      if (typeof document !== 'undefined' && document.hidden) {
        setTimeout(resolve, 16);
      } else {
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        var cap = setTimeout(finish, 32);
        requestAnimationFrame(function () { clearTimeout(cap); setTimeout(finish, 0); });
      }
    });

    this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId });
  }

  async _processComplete({ playlistId, importId, kind }) {
    if (this.abortedImports.has(importId)) return; // jamais de swap sur import avorté
    const isEpg = kind === 'epg';
    // kind 'playlist' (M3U ou Xtream) purge channels ET vod ; kind 'epg' ne purge que epg (DB-5)
    const targetTables = isEpg ? [db.epg] : [db.channels, db.vod];
    const activeField = isEpg ? 'activeEpgImportId' : 'activeImportId';

    // Swap atomique + purge strictement bornée à la playlist ET au type d'import.
    // Hors question ici : toute clause du type notEqual(importId) non bornée,
    // qui effacerait les imports actifs des AUTRES playlists.
    await db.transaction('rw', [db.playlists, db.imports, db.channels, db.epg, db.vod], async () => {
      await db.playlists.update(playlistId, Object.assign({ updatedAt: Date.now() }, { [activeField]: importId }));

      const oldImports = await db.imports
        .where('playlistId').equals(playlistId)
        .and(i => i.id !== importId && i.kind === (isEpg ? 'epg' : 'playlist'))
        .primaryKeys();

      if (oldImports.length > 0) {
        for (let t = 0; t < targetTables.length; t++) {
          await targetTables[t].where('importId').anyOf(oldImports).delete();
        }
        await db.imports.bulkDelete(oldImports);
      }

      await db.imports.update(importId, { status: 'completed' });
    });

    window.dispatchEvent(new CustomEvent('import-complete', { detail: { playlistId, importId, kind } }));
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.worker.onmessage = null;
    this.auxListeners = [];
  }
}
