// src/ui/VirtualList.js — spec §8.2 (verbatim).
// Windowing réel : pool recyclé, invariant §1.2-6 (nœuds ≤ clientHeight/itemHeight
// + 2*overscan + 1), rendu XSS-safe strict (textContent, jamais innerHTML).
import { BaseComponent } from '../core/BaseComponent.js';

export class VirtualList extends BaseComponent {
  constructor(container, options) {
    super();
    options = options || {};
    this.container = container;
    this.itemHeight = options.itemHeight || 60;
    this.overscan = options.overscan != null ? options.overscan : 4;
    this.items = [];
    this.pool = [];              // nœuds DOM recyclés — jamais > _maxNodes()
    this.rafPending = false;

    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';

    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    this.spacer.style.width = '100%';
    this.container.appendChild(this.spacer);

    this.boundOnScroll = this._onScroll.bind(this);
  }

  mount() {
    if (this._destroyed) return;
    this.container.addEventListener('scroll', this.boundOnScroll);
    this._renderWindow();
  }

  setItems(items) {
    if (this._destroyed) return;
    this.items = items || [];
    this.spacer.style.height = (this.items.length * this.itemHeight) + 'px';
    this._renderWindow();
  }

  _onScroll() {
    if (this.rafPending || this._destroyed) return;
    this.rafPending = true;
    const self = this;
    requestAnimationFrame(function () {
      self.rafPending = false;
      self._renderWindow();
    });
  }

  _maxNodes() {
    const h = this.container.clientHeight || 720;
    return Math.ceil(h / this.itemHeight) + 2 * this.overscan + 1; // invariant §1.2-6
  }

  _renderWindow() {
    if (this._destroyed) return;
    const scrollTop = this.container.scrollTop;
    const h = this.container.clientHeight || 720;
    const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
    const end = Math.min(this.items.length, Math.ceil((scrollTop + h) / this.itemHeight) + this.overscan);
    const needed = Math.min(end - start, this._maxNodes());

    while (this.pool.length < needed) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.tabIndex = -1; // focusable par FocusEngine sans tabulation native
      const style = row.style;
      style.position = 'absolute';
      style.top = '0';
      style.left = '0';
      style.right = '0';
      style.height = this.itemHeight + 'px';
      style.willChange = 'transform';
      const title = document.createElement('span');
      title.className = 'channel-title';
      row.appendChild(title);
      this.spacer.appendChild(row);
      this.pool.push(row);
    }

    for (let k = 0; k < this.pool.length; k++) {
      const rowEl = this.pool[k];
      const i = start + k;
      if (i < end) {
        rowEl.style.display = '';
        rowEl.style.transform = 'translateY(' + (i * this.itemHeight) + 'px)';
        rowEl.setAttribute('data-index', String(i));
        const item = this.items[i];
        // Rendu XSS-safe strict : textContent, jamais innerHTML (Invariant §1.2-3)
        rowEl.firstChild.textContent = String((item && item.name) || 'Chaîne ' + (i + 1));
      } else {
        rowEl.style.display = 'none';
      }
    }
  }

  // Sondage pour test d'invariant : doit toujours être <= _maxNodes()
  getRenderedNodeCount() {
    return this.pool.length;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.container.removeEventListener('scroll', this.boundOnScroll);
    while (this.spacer.firstChild) this.spacer.removeChild(this.spacer.firstChild);
    if (this.spacer.parentNode) this.spacer.parentNode.removeChild(this.spacer);
    this.pool = [];
    this.items = [];
  }
}
