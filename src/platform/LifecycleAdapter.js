// src/platform/LifecycleAdapter.js — spec §7.4 (verbatim).
// Libération VPU AVEC sauvegarde + restauration (test T1 « Home pendant lecture »).
export class LifecycleAdapter {
  /**
   * @param mediaAdapter MediaAdapter
   * @param urlResolver  async (url) => freshUrl — optionnel ; ré-authentifie les URL à token
   *                     expirant (patterns IPTV courants : ?token=, signatures courtes).
   *                     Si absent, l'URL est rejouée telle quelle.
   */
  constructor(mediaAdapter, urlResolver) {
    this._destroyed = false;
    this.mediaAdapter = mediaAdapter;
    this.urlResolver = typeof urlResolver === 'function' ? urlResolver : null;
    this.savedState = null;
    this._restoring = false;
    this.boundOnVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  init() {
    if (this._destroyed) return;
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
  }

  handleVisibilityChange() {
    if (this._destroyed) return;

    if (document.hidden) {
      const wasActive = this.mediaAdapter.state === 'PLAYING' ||
                        this.mediaAdapter.state === 'LOADING' ||
                        this.mediaAdapter.state === 'RECOVERING';
      this.savedState = {
        url: this.mediaAdapter.currentUrl,
        position: this.mediaAdapter.getPosition(), // utile VOD ; ignoré en Live
        wasActive: wasActive
      };
      // Destruction totale du pipeline → le VPU est libéré avant la suspension webOS
      this.mediaAdapter.releaseHardware();
      return;
    }

    // Retour avant-plan : reprise uniquement si une session était active
    if (this.savedState && this.savedState.wasActive && this.savedState.url && !this._restoring) {
      this._restoring = true;
      const snapshot = this.savedState;
      this.savedState = null;
      this._restore(snapshot);
    }
  }

  _restore(snapshot) {
    const self = this;
    const resolveUrl = this.urlResolver
      ? this.urlResolver(snapshot.url)
      : Promise.resolve(snapshot.url);

    resolveUrl.then(function (freshUrl) {
      if (self._destroyed) return;
      const requestId = self.mediaAdapter.play(freshUrl);
      // Reprise de position VOD : un seul essai, sur 'playing' du nouveau requestId
      if (snapshot.position > 5) {
        const seekOnce = function () {
          if (self.mediaAdapter.currentRequestId !== requestId) return;
          self.videoSeekTo(snapshot.position);
          self.mediaAdapter.videoEl.removeEventListener('playing', seekOnce);
        };
        self.mediaAdapter.videoEl.addEventListener('playing', seekOnce);
      }
    }).catch(function (err) {
      window.dispatchEvent(new CustomEvent('media-error', {
        detail: { message: 'RESTORE_FAILURE: ' + ((err && err.message) || err) }
      }));
    }).then(function () {
      self._restoring = false;
    });
  }

  videoSeekTo(position) {
    try { this.mediaAdapter.videoEl.currentTime = position; } catch (e) { /* flux live non cherchable */ }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
  }
}
