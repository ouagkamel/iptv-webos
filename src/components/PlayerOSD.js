// src/components/PlayerOSD.js — superposition d'état (dumb component) :
// nom de la chaîne + programme en cours/suivant + message d'état.
// Rendu XSS-safe strict : textContent uniquement (invariant §1.2-3).
export class PlayerOSD {
  constructor(rootEl) {
    this._destroyed = false;
    this.rootEl = rootEl;

    this.box = document.createElement('div');
    this.box.className = 'osd';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'osd-title';
    this.epgEl = document.createElement('div');
    this.epgEl.className = 'osd-epg';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'osd-status';

    this.box.appendChild(this.titleEl);
    this.box.appendChild(this.epgEl);
    this.box.appendChild(this.statusEl);
    this.rootEl.appendChild(this.box);

    this.hideTimer = null;
  }

  setChannel(name) { this.titleEl.textContent = String(name || ''); this._show(); }

  setEpg(now, next) {
    this.epgEl.textContent = (now ? now + '  ·  ' : '') + (next ? 'Suit: ' + next : '');
  }

  setStatus(message) {
    this.statusEl.textContent = String(message || '');
    this._show();
  }

  _show() {
    if (this._destroyed) return;
    this.box.classList.add('osd-visible');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const self = this;
    this.hideTimer = setTimeout(function () {
      if (!self._destroyed) self.box.classList.remove('osd-visible');
    }, 6000);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.box.parentNode) this.box.parentNode.removeChild(this.box);
  }
}
