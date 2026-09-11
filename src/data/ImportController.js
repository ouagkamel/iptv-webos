// src/data/ImportController.js — spec §5.8 (verbatim, mode xtream V9 inclus).
// Lecteur réseau + watermark 4 chunks texte (§5.7) + terminaison garantie dans
// tous les cas + PROT-6. Listeners de complétion attachés AVANT le premier envoi.
import { Capabilities } from '../utils/CapabilityDetector.js';
import { DEFAULT_IMPORT_PROFILE } from './ImportProfiles.js';

const MAX_INFLIGHT_TEXT = 4;                 // watermark réseau (§5.7)
const FALLBACK_MAX_BYTES = 30 * 1024 * 1024; // 30 Mo (politique §5.4)
const FALLBACK_SLICE = 256 * 1024;           // tranches du fallback non-streamé

export class ImportController {
  constructor(worker, dataManager) {
    this._destroyed = false;
    this.worker = worker;
    this.dataManager = dataManager;
    this.currentImportId = null;
    this.inflightText = 0;
    this.drainedWaiters = [];
    this.abortController = null;

    // Le DataManager détient worker.onmessage ; il route les signaux annexes ici.
    this.boundOnAuxMessage = this._onAuxMessage.bind(this);
    this.dataManager.addAuxListener(this.boundOnAuxMessage);
  }

  /**
   * job : { importId, playlistId, kind ('playlist'|'epg'), url }
   *   ou { importId, playlistId, kind:'playlist', source:'xtream', base, username, password }
   * Résout avec detail 'import-complete' ; rejette sur erreur réseau/DB/abort.
   * PROT-6 : un second appel pendant un import est rejeté immédiatement.
   */
  startImport(job) {
    if (this._destroyed) return Promise.reject(new Error('ImportController détruit'));
    if (this.currentImportId !== null) {
      window.dispatchEvent(new CustomEvent('import-busy', { detail: { inFlight: this.currentImportId } }));
      return Promise.reject(new Error('BUSY: import déjà en cours (PROT-6)'));
    }

    const importId = job.importId;
    this.currentImportId = importId;
    this.inflightText = 0;
    this.drainedWaiters = [];
    this._bytesPctSent = -1;
    this._bytesDone = 0;
    this._bytesMetaSent = false;
    const profile = job.profile || DEFAULT_IMPORT_PROFILE;
    const profileId = profile.id || DEFAULT_IMPORT_PROFILE.id;
    const profileLabel = profile.label || DEFAULT_IMPORT_PROFILE.label;
    const startedAt = Date.now();
    // Progression (V10, §9) : événement additif — aucun consommateur du
    // protocole §5.2 n'y est associé ; la suppression du badge ne régresse rien.
    window.dispatchEvent(new CustomEvent('import-start', {
      detail: { importId: importId, kind: job.kind,
                profileId: profileId, profileLabel: profileLabel }
    }));
    this.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const self = this;
    // Listeners attachés AVANT toute émission : un import-error (pompe, DB ou erreur
    // worker typée) émis en cours de route doit pouvoir rejeter cette promesse.
    const completionPromise = this._waitForCompletion(importId);

    if (job.source === 'xtream') {
      // Mode Xtream (§6.5) : le worker effectue lui-même les appels API paginés par
      // catégorie — pas de pompe réseau côté main thread, pas de watermark texte :
      // la mémoire est bornée par la plus grosse catégorie, jamais par le catalogue.
      this.worker.postMessage({
        type: 'INIT_IMPORT',
        importId: importId,
        playlistId: job.playlistId,
        kind: job.kind,
        base: job.base,
        username: job.username,
        password: job.password,
        profile: profile
      });
      return completionPromise.then(function (detail) {
        self._emitFinished(detail, startedAt, profileId, profileLabel);
        self._teardown();
        return detail;
      }, function (err) {
        self._teardown();
        throw err;
      });
    }

    this.worker.postMessage({
      type: 'INIT_IMPORT',
      importId: importId,
      playlistId: job.playlistId,
      kind: job.kind,
      profile: profile
    });

    this._pumpNetwork(job).then(function () {
      if (self.currentImportId === importId) {
        self.worker.postMessage({ type: 'END_OF_STREAM', importId: importId });
      }
      // Si avorté entre-temps : completionPromise a déjà rejeté via 'import-aborted'.
    }).catch(function (err) {
      if (self.currentImportId === importId) {
        // Échec pompe → terminaison symétrique via le canal d'erreur unique (§1.2-1)
        self.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId });
        window.dispatchEvent(new CustomEvent('import-error', {
          detail: { importId: importId, message: String((err && err.message) || err) }
        }));
      }
      // Si abort() public : 'import-aborted' déjà émis par abort().
    });

    return completionPromise.then(function (detail) {
      self._emitFinished(detail, startedAt, profileId, profileLabel);
      self._teardown();
      return detail;
    }, function (err) {
      self._teardown();
      throw err;
    });
  }

  _emitFinished(detail, startedAt, profileId, profileLabel) {
    try {
      window.dispatchEvent(new CustomEvent('import-finished', { detail: Object.assign({}, detail, {
        elapsedMs: Date.now() - startedAt, profileId: profileId, profileLabel: profileLabel
      }) }));
    } catch (eFinished) { /* métrique UI non bloquante */ }
  }

  abort() {
    const importId = this.currentImportId;
    if (importId === null || this._destroyed) return;
    // PROT-5 : le DataManager doit connaître l'abort pour acquitter SANS écrire
    // les CHUNK déjà en vol (sinon une ligne livrée après l'abort serait persistée).
    this.dataManager.abortedImports.add(importId);
    if (this.abortController) {
      try { this.abortController.abort(); } catch (eAbort) { /* noop */ }
    }
    try { this.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId }); } catch (eAbort2) { /* noop */ }
    window.dispatchEvent(new CustomEvent('import-aborted', { detail: { importId: importId } }));
    // _teardown() exécuté par la terminaison de startImport (voie unique)
  }

  async _pumpNetwork(job) {
    const importId = job.importId;
    const fetchOptions = this.abortController ? { signal: this.abortController.signal } : {};
    const response = await fetch(job.url, fetchOptions);
    if (!response.ok) throw new Error('HTTP_' + response.status);

    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10) || 0;
    this._emitBytes(importId, 0, contentLength, true);
    const canStream = Capabilities.hasFetch && Capabilities.hasReadableStream && Capabilities.hasTextDecoder &&
                      response.body && typeof response.body.getReader === 'function';

    if (!canStream) {
      // Politique actée §5.4 : plafond dur 30 Mo ; taille inconnue → refus (borne mémoire impossible)
      if (contentLength === 0) throw new Error('CONTENT_LENGTH_ABSENT_NO_STREAMING');
      if (contentLength > FALLBACK_MAX_BYTES) throw new Error('FILE_TOO_LARGE_NO_STREAMING');
      const fullText = await response.text();
      for (let start = 0; start < fullText.length; start += FALLBACK_SLICE) {
        if (this.currentImportId !== importId) return; // avorté : sortie silencieuse
        this._sendParseChunk(importId, fullText.slice(start, start + FALLBACK_SLICE));
        this._emitBytes(importId, Math.min(start + FALLBACK_SLICE, fullText.length), contentLength);
        // await-in-loop volontaire : rendu de main pour intercepter ABORT entre tranches
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let bytesDone = 0;

    let result = await reader.read();
    while (!result.done) {
      if (this.currentImportId !== importId) {
        try { reader.cancel(); } catch (e1) { /* noop */ }
        return;
      }
      if (result.value) {
        bytesDone += result.value.byteLength || 0;
        this._emitBytes(importId, bytesDone, contentLength);
      }
      // { stream: true } : les séquences UTF-8 multi-octets coupées entre chunks réseau
      // sont conservées pour le decode suivant — défense complémentaire au carryOver XML
      const text = decoder.decode(result.value, { stream: true });
      if (text.length > 0) {
        const free = await this._awaitSlotOrAborted(importId); // watermark (§5.7)
        if (!free) {
          try { reader.cancel(); } catch (e2) { /* noop */ }
          return;
        }
        this._sendParseChunk(importId, text);
      }
      result = await reader.read();
    }

    const tail = decoder.decode(); // flush final du décodeur
    if (tail.length > 0) {
      const freeTail = await this._awaitSlotOrAborted(importId);
      if (!freeTail) return;
      this._sendParseChunk(importId, tail);
    }
    if (contentLength > 0) this._emitBytes(importId, contentLength, contentLength, true);
  }

  // Progression réseau (V10, §9) : import-meta (bytesTotal) au premier
  // Content-Length connu, puis import-progress throttlé (≥ 1 % ou 256 Ko).
  // Jamais bloquant : try/catch total, la progression ne fait échouer un import.
  _emitBytes(importId, done, total, force) {
    if (!total || total <= 0) return; // taille inconnue → pas de meta (indéterminé)
    try {
      if (!this._bytesMetaSent) {
        this._bytesMetaSent = true;
        window.dispatchEvent(new CustomEvent('import-meta', {
          detail: { importId: importId, bytesTotal: total }
        }));
      }
      const pct = Math.floor((done / total) * 100);
      const bigJump = done - this._bytesDone >= 256 * 1024;
      if (!force && pct <= this._bytesPctSent && !bigJump) return;
      this._bytesPctSent = pct;
      this._bytesDone = done;
      window.dispatchEvent(new CustomEvent('import-progress', {
        detail: { importId: importId, bytesDone: done }
      }));
    } catch (eEmit) { /* jamais bloquant */ }
  }

  _sendParseChunk(importId, text) {
    this.inflightText += 1;
    this.worker.postMessage({ type: 'PARSE_CHUNK', importId: importId, xmlChunk: text });
  }

  _awaitSlotOrAborted(importId) {
    const self = this;
    if (this.currentImportId !== importId) return Promise.resolve(false);
    if (this.inflightText < MAX_INFLIGHT_TEXT) return Promise.resolve(true);
    return new Promise(function (resolve) {
      self.drainedWaiters.push(function () {
        resolve(self.currentImportId === importId);
      });
    });
  }

  _onAuxMessage(data) {
    if (!data || data.type !== 'CHUNK_PARSED') return;
    if (data.importId !== this.currentImportId) return;
    this.inflightText = Math.max(0, this.inflightText - 1);
    this._releaseWaiters();
  }

  _releaseWaiters() {
    // Un ack = un slot : on libère UN seul waiter (sinon rafale > watermark,
    // car les waiters résolus n'incrémentent inflightText qu'après leur microtask)
    if (this.drainedWaiters.length > 0 && this.inflightText < MAX_INFLIGHT_TEXT) {
      this.drainedWaiters.shift()();
    }
  }

  _waitForCompletion(importId) {
    return new Promise(function (resolve, reject) {
      function matches(e) { return e.detail && e.detail.importId === importId; }
      function cleanup() {
        window.removeEventListener('import-complete', onComplete);
        window.removeEventListener('import-error', onError);
        window.removeEventListener('import-aborted', onAborted);
      }
      function onComplete(e) { if (matches(e)) { cleanup(); resolve(e.detail); } }
      function onError(e) { if (matches(e)) { cleanup(); reject(new Error(e.detail.message || 'import-error')); } }
      function onAborted(e) { if (matches(e)) { cleanup(); reject(new Error('IMPORT_ABORTED')); } }
      window.addEventListener('import-complete', onComplete);
      window.addEventListener('import-error', onError);
      window.addEventListener('import-aborted', onAborted);
    });
  }

  _teardown() {
    this.currentImportId = null;
    this.inflightText = 0;
    // Libère tout waiter suspendu : les résolutions sont des microtasks exécutées
    // après ce teardown (currentImportId déjà null) → la pompe sort proprement.
    while (this.drainedWaiters.length > 0) {
      const release = this.drainedWaiters.shift();
      try { release(); } catch (e3) { /* noop */ }
    }
    this.abortController = null;
  }

  destroy() {
    if (this._destroyed) return;
    this.abort();
    this._destroyed = true;
    this.dataManager.removeAuxListener(this.boundOnAuxMessage);
    this.drainedWaiters = [];
  }
}
