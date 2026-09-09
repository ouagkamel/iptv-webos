// src/ui/FocusEngine.js — spec §8.1 (verbatim).
// case 13 (OK webOS/Entrée) + hystérésis Magic Remote 5 px + pile LIFO de back handlers.
export class FocusEngine {
  constructor() {
    this._destroyed = false;
    this.focusableElements = [];
    this.currentIndex = -1;
    this.lastMouseX = -1;
    this.lastMouseY = -1;
    this.threshold = 5;          // hystérésis gyroscope Magic Remote (px)
    this.backHandlers = [];      // pile LIFO : modal > OSD > …

    // Listeners nommés et liés — retire-ables au destroy (Invariant §1.2-4)
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnMouseMove = this.handleMouseMove.bind(this);
  }

  init() {
    if (this._destroyed) return;
    window.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('mousemove', this.boundOnMouseMove);
  }

  setFocusables(elements) {
    this.focusableElements = elements || [];
    if (this.currentIndex >= this.focusableElements.length) {
      this.currentIndex = this.focusableElements.length - 1;
    }
  }

  handleMouseMove(e) {
    if (this._destroyed) return;
    if (this.lastMouseX === -1) { // première mesure : initialiser sans activer
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }
    const deltaX = Math.abs(e.clientX - this.lastMouseX);
    const deltaY = Math.abs(e.clientY - this.lastMouseY);
    if (deltaX < this.threshold && deltaY < this.threshold) return; // micro-tremblements gyro
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    document.body.classList.add('magic-remote-active');
  }

  handleKeyDown(e) {
    if (this._destroyed) return;
    document.body.classList.remove('magic-remote-active');

    switch (e.keyCode) {
      case 37: this.navigate(-1); break; // Left
      case 38: this.navigate(-1); break; // Up   (liste verticale)
      case 39: this.navigate(1);  break; // Right
      case 40: this.navigate(1);  break; // Down
      case 13:                         // OK / Entrée webOS
        e.preventDefault();
        this.activateCurrent();
        break;
      case 461:                        // Back webOS
        e.preventDefault();
        this.handleSystemBack();
        break;
      default: break;
    }
  }

  // Un <div tabindex="-1"> ne déclenche AUCUN click natif sur Entrée (contrairement
  // à <button>/<a>) : l'activation D-Pad passe par ce canal explicite. L'activation
  // au pointeur Magic Remote, elle, reste un click natif géré par les composants.
  activateCurrent() {
    const el = this.focusableElements[this.currentIndex];
    if (!el) return;
    const attr = el.getAttribute('data-index');
    const parsed = attr !== null ? parseInt(attr, 10) : NaN;
    window.dispatchEvent(new CustomEvent('focus-activate', {
      detail: { element: el, index: isNaN(parsed) ? this.currentIndex : parsed }
    }));
  }

  navigate(direction) {
    const count = this.focusableElements.length;
    if (count === 0) return;
    this.currentIndex = (this.currentIndex + direction + count) % count;
    const el = this.focusableElements[this.currentIndex];
    if (el && typeof el.focus === 'function') el.focus();
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' }); // supporté Chromium 68
    }
  }

  // Pile de retour : chaque modal/OSD pousse un handler, le dépile à sa fermeture
  pushBackHandler(fn) { this.backHandlers.push(fn); }
  removeBackHandler(fn) {
    const i = this.backHandlers.indexOf(fn);
    if (i !== -1) this.backHandlers.splice(i, 1);
  }

  handleSystemBack() {
    if (this.backHandlers.length > 0) {
      this.backHandlers[this.backHandlers.length - 1]();
      return;
    }
    // Plus rien à fermer : rendre la main à webOS (menu Home / sortie d'app)
    if (window.webOS && typeof window.webOS.platformBack === 'function') {
      window.webOS.platformBack();
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('mousemove', this.boundOnMouseMove);
    this.focusableElements = [];
    this.backHandlers = [];
  }
}
