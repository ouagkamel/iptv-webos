// src/media/MediaAdapter.js — spec §7.2 + amendement V14 (démarrage FHD).
// Matrice §7.1 : passage unique NATIVE → HLS_MSE, budgets de reconnexion PAR MOTEUR,
// requestId anti-race (zapping), AUTHORIZATION_ERROR 401/403 sans retry,
// recoveryTimer annulable (anti timer-zombie, correction V7-nitpick).
import Hls from 'hls.js';
import { MediaWatchdog } from './Watchdog.js';

// V14 §7.2 : le budget de démarrage est une FENÊTRE D'INACTIVITÉ, plus un plafond
// absolu. Justification (trace panneau réel 2026-09-10) : sur chaînes FHD, un
// premier segment de ~3 Mo + un 302 de playlist = 11–13 s avant la première
// image ; le cap dur de 10 s tuait des flux sains (« STARTUP_FAILURE: startup
// timeout 10000ms »). Tout marqueur de progression (événement réseau hls.js ou
// événement média natif) réarme la fenêtre ; DEADLINE_MS borne le total pour
// qu'un flux qui « progresse » sans jamais livrer d'image échoue proprement.
const STARTUP_TIMEOUT_MS = 10000;   // max 10 s SANS AUCUNE progression
const STARTUP_DEADLINE_MS = 45000;  // max 45 s au total jusqu'à la première image
const MAX_RECOVERIES = 1;
const STARTUP_PROGRESS_MEDIA_EVENTS = ['loadedmetadata', 'loadeddata', 'progress', 'canplay', 'timeupdate'];
const STARTUP_PROGRESS_HLS_EVENTS = ['MANIFEST_LOADED', 'LEVEL_LOADED',
  'FRAG_LOADED', 'FRAG_BUFFERED', 'BUFFER_APPENDED'];
const STARTUP_ACTIVE_HLS_EVENTS = ['MANIFEST_LOADING', 'LEVEL_LOADING', 'FRAG_LOADING'];

export class MediaAdapter {
  constructor(videoElement) {
    this._destroyed = false;
    this.videoEl = videoElement;
    this.state = 'IDLE';       // IDLE | LOADING | PLAYING | RECOVERING | ERROR | ENDED
    this.engine = null;        // null | 'NATIVE' | 'HLS_MSE'
    // Le vidage de src du _teardownPlayback() de _fallbackToHls met un MediaError
    // code 4 en file d'attente (Chromium), livré juste après attachMedia : il tuait
    // le MSE naissant (xhr playlist « canceled » 0 B — revue simulateur webOS).
    // Critère : tant que le manifeste n'est pas parsé, une error code 4 sur le
    // pipeline MSE sans buffer est cette erreur de vidage → ignorée (le filet est
    // le startup timeout §7.2 + les erreurs réseau proprement dites via hls).
    this._mseParsed = false;
    // Génération de tentative de lecture : le vidage du fallback annule (rejette)
    // le play() natif EN VOL — rejet AbortError/NotSupportedError qui arrive APRÈS
    // l'attach MSE. Sans ce compteur, ce rejet périmé escaladait en _onStartupFailure
    // et détruisait le hls naissant (second visage de la course revue au simulateur :
    // xhr playlist « canceled » 0 B). Un rejet dont la génération n'est plus courante
    // ne décrit plus aucune lecture en cours → ignoré ; le filet reste §7.2.
    this._playGen = 0;
    this.hls = null;
    this.currentUrl = null;
    this.currentRequestId = 0;
    this.recoveries = 0;
    this.startupTimer = null;
    this.recoveryTimer = null;   // reconnexion planifiée, annulable (anti timer-zombie)
    // Réglages sur l'instance (les tests les réduisent ; production = constantes) :
    this.startupMs = STARTUP_TIMEOUT_MS;
    this.startupDeadlineMs = STARTUP_DEADLINE_MS;
    this._startupDeadlineAt = 0; // Date.now() limite ; 0 = phase de démarrage soldée
    this._hlsNetworkActive = false; // requête playlist/segment en cours connue de hls.js
    this.watchdog = new MediaWatchdog(this);

    this.boundOnVideoError = this._onVideoError.bind(this);
    this.boundOnPlaying = this._onPlaying.bind(this);
    this.boundOnEnded = this._onEnded.bind(this);
    this.boundOnStartupProgress = this._noteStartupProgress.bind(this);
  }

  init() {
    if (this._destroyed) return;
    this.videoEl.addEventListener('error', this.boundOnVideoError);
    this.videoEl.addEventListener('playing', this.boundOnPlaying);
    this.videoEl.addEventListener('ended', this.boundOnEnded);
    // V14 : progression observable du <video> (buffer qui se remplit) = preuve de vie
    for (let i = 0; i < STARTUP_PROGRESS_MEDIA_EVENTS.length; i++) {
      this.videoEl.addEventListener(STARTUP_PROGRESS_MEDIA_EVENTS[i], this.boundOnStartupProgress);
    }
  }

  play(streamUrl) {
    if (this._destroyed) return -1;
    const requestId = ++this.currentRequestId;
    this._teardownPlayback();
    this.currentUrl = streamUrl;
    this.recoveries = 0;
    this._hlsNetworkActive = false;
    this.engine = 'NATIVE';
    this.state = 'LOADING';
    this._startupDeadlineAt = Date.now() + this.startupDeadlineMs;
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
    const gen = ++this._playGen;
    let p = null;
    try { p = this.videoEl.play(); } catch (e) { /* sync throw → fallback */ }
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (gen !== this._playGen) return; // rejet périmé : tentative supplantée
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
    this._startupDeadlineAt = 0;
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
    if (this.engine === 'HLS_MSE' && this.hls && !this._mseParsed &&
        this.videoEl.error && this.videoEl.error.code === 4) {
      return; // erreur stale du vidage : ne détruit pas le hls en cours d'attach
    }
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
    this._mseParsed = false;
    this.state = 'LOADING';
    // Budget de reconnexion frais PAR MOTEUR (taxonomie : "max 1 par moteur").
    // Sans cette remise à zéro, un fallback atteint après épuisement du jeton
    // NATIVE laisserait HLS_MSE sans AUCUNE marge réseau : la résilience
    // dépendrait du chemin d'arrivée sur le moteur — asymétrie inacceptable.
    this.recoveries = 0;
    this._hlsNetworkActive = false;

    if (!Hls.isSupported()) {
      this._setError('MSE_NON_SUPPORTE');
      return;
    }

    this._armStartupTimeout(requestId);
    const hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
    this.hls = hlsInstance;
    const isCurrentHls = () => this.hls === hlsInstance && this.currentRequestId === requestId;

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (isCurrentHls()) { this._mseParsed = true; this._markHlsActivity(false); }
    });
    // V14 : progression réseau hls.js (frags, playlists de live rechargées)
    // réarme la fenêtre d'inactivité. Les événements *_LOADING sont importants :
    // un segment FHD de 3 Mo peut être en transfert > 10 s sans encore émettre
    // FRAG_LOADED ; le timeout ne doit pas confondre « requête active » et silence.
    for (let i = 0; i < STARTUP_PROGRESS_HLS_EVENTS.length; i++) {
      const evt = Hls.Events[STARTUP_PROGRESS_HLS_EVENTS[i]];
      if (evt) hlsInstance.on(evt, () => { if (isCurrentHls()) this._noteStartupProgress(); });
    }
    for (let i = 0; i < STARTUP_ACTIVE_HLS_EVENTS.length; i++) {
      const evt = Hls.Events[STARTUP_ACTIVE_HLS_EVENTS[i]];
      if (evt) hlsInstance.on(evt, () => { if (isCurrentHls()) this._markHlsActivity(true); });
    }
    // Les événements chargés repassent l'indicateur à inactif, sans changer le
    // plafond absolu. MANIFEST_PARSED est traité séparément ci-dessus.
    const hlsLoadedEvents = ['MANIFEST_LOADED', 'LEVEL_LOADED', 'FRAG_LOADED', 'FRAG_BUFFERED', 'BUFFER_APPENDED'];
    for (let i = 0; i < hlsLoadedEvents.length; i++) {
      const evt = Hls.Events[hlsLoadedEvents[i]];
      if (evt) hlsInstance.on(evt, () => { if (isCurrentHls()) this._markHlsActivity(false); });
    }
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
    // V14 : fenêtre = min(inactivité max, reste du plafond absolu). Le plafond,
    // lui, n'est JAMAIS réarmé par la progression — c'est ce qui distingue
    // « flux lent mais vivant » (prolongé) de « flux pourri » (45 s).
    let delay = this.startupMs;
    if (this._startupDeadlineAt > 0) {
      const remain = this._startupDeadlineAt - Date.now();
      if (remain < delay) delay = remain < 0 ? 0 : remain;
    }
    this.startupTimer = setTimeout(() => {
      if (this._destroyed || this.currentRequestId !== requestId) return;
      this.startupTimer = null;
      if (this._startupDeadlineAt > 0 && Date.now() >= this._startupDeadlineAt) {
        if (this.state === 'LOADING' || this.state === 'RECOVERING') {
          this._setError('STARTUP_TIMEOUT_CAP: aucune première image sous ' + this.startupDeadlineMs + 'ms (progression sans aboutissement)');
        }
        return;
      }
      if (this.state === 'LOADING') {
        if (this._startupNetworkActive()) {
          // Trace FHD : une requête m3u8/TS peut être active sans événement media
          // pendant plusieurs secondes. On garde le filet du plafond absolu.
          this._armStartupTimeout(requestId);
        } else {
          this._onStartupFailure(requestId, 'aucune progression depuis ' + this.startupMs + 'ms');
        }
      } else if (this.state === 'RECOVERING') {
        this._tryRecover('recovery timeout'); // compteur épuisé → fallback ou ERROR
      }
    }, delay);
  }

  /** V14 : tout signe de téléchargement/buffering en phase LOADING/RECOVERING
   *  repousse l'échéance d'inactivité (jamais le plafond absolu). */
  _noteStartupProgress() {
    if (this._destroyed) return;
    if (this.state !== 'LOADING' && this.state !== 'RECOVERING') return;
    if (!this.startupTimer) return;
    if (this._startupDeadlineAt > 0 && Date.now() >= this._startupDeadlineAt) return;
    this._armStartupTimeout(this.currentRequestId);
  }

  _markHlsActivity(active) {
    this._hlsNetworkActive = !!active;
    this._noteStartupProgress();
  }

  _startupNetworkActive() {
    if (this.engine === 'HLS_MSE') return this._hlsNetworkActive;
    if (this.engine === 'NATIVE') {
      // HTMLMediaElement.NETWORK_LOADING = 2. Certains webOS exposent la valeur
      // mais n'émettent pas régulièrement « progress » pour les gros TS FHD.
      return this.videoEl && this.videoEl.networkState === 2;
    }
    return false;
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
    this._hlsNetworkActive = false;
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
    for (let i = 0; i < STARTUP_PROGRESS_MEDIA_EVENTS.length; i++) {
      this.videoEl.removeEventListener(STARTUP_PROGRESS_MEDIA_EVENTS[i], this.boundOnStartupProgress);
    }
  }
}
