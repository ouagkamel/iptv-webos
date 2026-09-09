// src/core/BaseComponent.js — spec §1.3 (verbatim)
export class BaseComponent {
  constructor() {
    this._destroyed = false;
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
  }

  mount(parent) {
    if (this._destroyed) return;
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  handleKeyDown(event) {
    // À surcharger par les classes filles
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener('keydown', this.boundOnKeyDown);
  }
}
