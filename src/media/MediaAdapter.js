// src/media/MediaAdapter.js — spec §7.2 (verbatim).
// Matrice §7.1 : passage unique NATIVE → HLS_MSE, budgets de reconnexion PAR MOTEUR,
// requestId anti-race (zapping), AUTHORIZATION_ERROR 401/403 sans retry,
// recoveryTimer annulable (anti timer-zombie, correction V7-nitpick).
import Hls from 'hls.js';
import { MediaWatchdog } from './Watchdog.js';

const STARTUP_TIMEOUT_MS = 10000;
const MAX_RECOVERIES = 1;

export class MediaAdapter {
  constructor(videoElement) {
    this._destroyed = false;
    this.videoEl = videoElement;
    this.state = 'IDLE';       // IDLE | LOADING | PLAYING | RECOVERING | ERROR | ENDED
    this.engine = null;        // null | 'NATIVE' | 'HLS_MSE'
    this.hls = null;
    this.currentUrl = null;
    this.currentRequestId = 0;
    this.recoveries = 0;
    this.startupTimer = null;
    this.recoveryTimer = null;   // reconnexion planifiée, annulable (anti timer-zombie)
    this.watchdog = new MediaWatchdog(this);

    this.boundOnVideoError = this._onVideoError.bind(this);
    this.boundOnPlaying = this._onPlaying.bind(this);
    this.boundOnEnded = this._onEnded.bind(this);
  }

  init() {
    if (this._destroyed) return;
    this.videoEl.addEventListener('error', this.boundOnVideoError);
    this.videoEl.addEventListener('playing', this.boundOnPlaying);
    this.videoEl.addEventListener('ended', this.boundOnEnded);
  }

  play(streamUrl) {
    if (this._destroyed) return -1;
    const requestId = ++this.currentRequestId;
    this._teardownPlayback();
    this.currentUrl = streamUrl;
    this.recoveries = 0;
    this.engine = 'NATIVE';
    this.state = 'LOADING';
    this._armStartupTimeout(requestId);
    this.videoEl.src = streamUrl;
    this._tryPlay(requestId);
    return requestId;
  }

  /** Arrêt propre réutilisable (fermeture de l'overlay lecteur) : solde la session en
   *  IDLE sans détruire l'adaptateur ; le prochain play() repart à neuf. Le
   *  LifecycleAdapter voit state==='IDLE' (wasActive=false) et ne tente aucune
   *  reprise sur une session volontairement fermée (§7.4 ne resume que l'actif). */
  stop() {
    if (this._destroyed) return;
    this._teardownPlayback();
    this.currentUrl = null;
    this.state = 'IDLE';
  }

  _tryPlay(requestId) {
    let p = null;
    try { p = this.videoEl.play(); } catch (e) { /* sync throw → fallback */ }
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (this.currentRequestId !== requestId || this._destroyed) return;
        if (this.state === 'LOADING') {
          this._onStartupFailure(requestId, 'play() rejected: ' + (err && err.name));
        } else if (this.state === 'RECOVERING') {
          this._tryRecover('play() rejected during recovery'); // compteur épuisé → fallback/ERROR
        }
      });
    }
  }

  _onPlaying() {
    if (this._destroyed || this.state === 'IDLE' || this.state === 'ERROR') return;
    this.state = 'PLAYING';
    this._clearStartupTimeout();
    this.watchdog.start(this.currentRequestId);
  }

  _onEnded() {
    if (this._destroyed) return;
    this.state = 'ENDED';
    this.watchdog.stop();
  }

  _onVideoError() {
    if (this._destroyed) return;
    if (this.state === 'LOADING') {
      this._onStartupFailure(this.currentRequestId, 'native <video> error event');
    } else if (this.state === 'PLAYING') {
      this._onPlaytimeFailure('native runtime error');
    } else if (this.state === 'RECOVERING') {
      this._tryRecover('error event during recovery'); // la reconnexion a échoué
    }
  }

  _onStartupFailure(requestId, reason) {
    if (this.currentRequestId !== requestId || this._destroyed) return;
    if (this.engine === 'NATIVE') {
      console.warn('STARTUP_INCOMPATIBILITY (' + reason + ') → fallback HLS_MSE');
      this._fallbackToHls(requestId);
    } else {
      this._setError('STARTUP_FAILURE: ' + reason);
    }
  }

  _onPlaytimeFailure(reason) {
    // Taxonomie d'origine : NETWORK_INTERRUPTION → reconnexion intra-moteur ×1 AVANT tout
    // changement de moteur. La bascule NATIVE → HLS_MSE n'intervient qu'à l'épuisement
    // de cette tentative (passage unique toujours respecté : jamais de retour MSE → NATIVE).
    this._tryRecover(reason);
  }

  handleStallTimeout() {
    // Appelé par le Watchdog (one-shot) après 8 s sans progression en PLAYING
    if (this._destroyed || this.state !== 'PLAYING') return;
    this._onPlaytimeFailure('WATCHDOG_STALL_8S');
  }

  _tryRecover(reason) {
    if (this.recoveries >= MAX_RECOVERIES) {
      if (this.engine === 'NATIVE') {
        // Retry intra-moteur épuisé → le second moteur reste disponible (passage unique)
        console.warn('NATIVE recovery exhausted (' + reason + ') → fallback HLS_MSE');
        this._fallbackToHls(this.currentRequestId);
      } else {
        this._setError('NETWORK_INTERRUPTION exhausting retries: ' + reason);
      }
      return;
    }
    this.recoveries += 1;
    this.state = 'RECOVERING';
    this.watchdog.stop();
    this._armStartupTimeout(this.currentRequestId); // borne aussi la phase de reconnexion
    const requestId = this.currentRequestId;
    const self = this;
    this.recoveryTimer = setTimeout(function () {
      self.recoveryTimer = null;
      if (self._destroyed || self.currentRequestId !== requestId) return;
      if (self.engine === 'HLS_MSE' && self.hls) {
        self.hls.startLoad(-1);   // relance le pipeline réseau hls.js
      } else if (self.engine === 'NATIVE') {
        self.videoEl.src = self.currentUrl;
        self._tryPlay(requestId); // reconnexion intra-moteur (coupures < seuil : le natif reprend seul)
      }
    }, 1000);
  }

  _fallbackToHls(requestId) {
    if (this._destroyed || this.engine !== 'NATIVE') return; // passage unique
    this._teardownPlayback();
    this.engine = 'HLS_MSE';
    this.state = 'LOADING';
    // Budget de reconnexion frais PAR MOTEUR (taxonomie : "max 1 par moteur").
    // Sans cette remise à zéro, un fallback atteint après épuisement du jeton
    // NATIVE laisserait HLS_MSE sans AUCUNE marge réseau : la résilience
    // dépendrait du chemin d'arrivée sur le moteur — asymétrie inacceptable.
    this.recoveries = 0;

    if (!Hls.isSupported()) {
      this._setError('MSE_NON_SUPPORTE');
      return;
    }

    this._armStartupTimeout(requestId);
    const hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
    this.hls = hlsInstance;

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      // Garde générationnelle : instance courante + requestId courant
      if (this._destroyed || this.hls !== hlsInstance || this.currentRequestId !== requestId) return;
      if (data && data.response && (data.response.code === 401 || data.response.code === 403)) {
        this._setError('AUTHORIZATION_ERROR HTTP ' + data.response.code); // jamais de retry
        return;
      }
      if (data && data.fatal) {
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.recoveries < MAX_RECOVERIES) {
          this.recoveries += 1;
          hlsInstance.recoverMediaError();
        } else {
          this._tryRecover('HLS_FATAL_' + (data && data.type));
        }
      }
    });

    hlsInstance.loadSource(this.currentUrl);
    hlsInstance.attachMedia(this.videoEl);
    this._tryPlay(requestId);
  }

  _armStartupTimeout(requestId) {
    this._clearStartupTimeout();
    this.startupTimer = setTimeout(() => {
      if (this._destroyed || this.currentRequestId !== requestId) return;
      if (this.state === 'LOADING') {
        this._onStartupFailure(requestId, 'startup timeout ' + STARTUP_TIMEOUT_MS + 'ms');
      } else if (this.state === 'RECOVERING') {
        this._tryRecover('recovery timeout'); // compteur épuisé → fallback ou ERROR
      }
    }, STARTUP_TIMEOUT_MS);
  }

  _clearStartupTimeout() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  _setError(message) {
    this.state = 'ERROR';
    const detail = { requestId: this.currentRequestId, url: this.currentUrl, message: message };
    this._teardownPlayback();
    window.dispatchEvent(new CustomEvent('media-error', { detail: detail }));
  }

  _teardownPlayback() {
    this.watchdog.stop();
    this._clearStartupTimeout();
    // Annule toute reconnexion planifiée : un changement de moteur/session pendant
    // la fenêtre d'attente (1 s) ne doit jamais laisser un timer zombie agir sur
    // le nouvel état (ex. startLoad() sur la fraîche instance hls.js).
    if (this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.videoEl) {
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }
  }

  getPosition() {
    return this.videoEl ? this.videoEl.currentTime : 0;
  }

  // Libération VPU sans destruction de l'adapter (réutilisable au retour de veille)
  releaseHardware() {
    this._teardownPlayback();
    this.state = 'IDLE';
    this.engine = null;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.releaseHardware();
    this.videoEl.removeEventListener('error', this.boundOnVideoError);
    this.videoEl.removeEventListener('playing', this.boundOnPlaying);
    this.videoEl.removeEventListener('ended', this.boundOnEnded);
  }
}
