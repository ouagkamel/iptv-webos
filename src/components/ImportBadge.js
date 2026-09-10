// src/components/ImportBadge.js — vignette d'état d'import (V10, §9).
// Composant NON INTERACTIF hors FocusEngine (jamais focusable) : il écoute les
// événements additifs window import-start / import-meta / import-progress /
// import-phase / import-rows / import-complete / import-error / import-aborted. Aucun lien
// avec le protocole worker §5.2 : le retirer ne peut pas régresser un import.
// Rendu XSS-safe strict : textContent uniquement (invariant §1.2-3).
export class ImportBadge {
  constructor(rootEl) {
    this._destroyed = false;
    this._lines = new Map(); // importId -> état + nœuds
    this._max = 3;           // jamais plus de 3 lignes (écran 720p/1080p)

    this.box = document.createElement('div');
    this.box.className = 'import-badge';
    this.box.setAttribute('aria-live', 'polite');
    this.box.setAttribute('tabindex', '-1');
    rootEl.appendChild(this.box);
    this._rootEl = rootEl;

    this._onStart = this._onStart.bind(this);
    this._onMeta = this._onMeta.bind(this);
    this._onProgress = this._onProgress.bind(this);
    this._onPhase = this._onPhase.bind(this);
    this._onRows = this._onRows.bind(this);
    this._onComplete = this._onComplete.bind(this);
    this._onError = this._onError.bind(this);
    this._onAborted = this._onAborted.bind(this);
    window.addEventListener('import-start', this._onStart);
    window.addEventListener('import-meta', this._onMeta);
    window.addEventListener('import-progress', this._onProgress);
    window.addEventListener('import-phase', this._onPhase);
    window.addEventListener('import-rows', this._onRows);
    window.addEventListener('import-complete', this._onComplete);
    window.addEventListener('import-error', this._onError);
    window.addEventListener('import-aborted', this._onAborted);
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('import-start', this._onStart);
    window.removeEventListener('import-meta', this._onMeta);
    window.removeEventListener('import-progress', this._onProgress);
    window.removeEventListener('import-phase', this._onPhase);
    window.removeEventListener('import-rows', this._onRows);
    window.removeEventListener('import-complete', this._onComplete);
    window.removeEventListener('import-error', this._onError);
    window.removeEventListener('import-aborted', this._onAborted);
    var self = this;
    this._lines.forEach(function (st) { if (st.timer) clearTimeout(st.timer); });
    this._lines.clear();
    if (this.box.parentNode) this.box.parentNode.removeChild(this.box);
  }

  // ————— événements —————

  _onStart(e) {
    var d = e && e.detail;
    if (this._destroyed || !d || d.importId == null) return;
    if (this._lines.has(d.importId)) return; // idempotent

    if (this._lines.size >= this._max) { // borne stricte : on droppe la plus ancienne finie
      var oldest = null;
      this._lines.forEach(function (st, id) { if (oldest === null) oldest = id; });
      if (oldest !== null) this._drop(oldest);
    }

    var row = document.createElement('div');
    row.className = 'imp-line';
    var line = document.createElement('div');
    line.className = 'imp-row';
    var labelEl = document.createElement('span');
    labelEl.className = 'imp-label';
    labelEl.textContent = d.kind === 'epg' ? 'Import guide (EPG)' : 'Import playlist';
    var pctEl = document.createElement('span');
    pctEl.className = 'imp-pct';
    pctEl.textContent = '…';
    var bar = document.createElement('div');
    bar.className = 'imp-bar';
    var fill = document.createElement('div');
    fill.className = 'imp-bar-fill';
    bar.appendChild(fill);
    line.appendChild(labelEl);
    line.appendChild(pctEl);
    row.appendChild(line);
    row.appendChild(bar);
    this.box.appendChild(row);
    row.classList.add('indet');

    this._lines.set(d.importId, {
      row: row, labelEl: labelEl, pctEl: pctEl, fill: fill,
      written: 0, totalItems: 0, bytesDone: 0, bytesTotal: 0, timer: null
    });
  }

  _onMeta(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    if (typeof d.totalItems === 'number' && d.totalItems > 0) st.totalItems = d.totalItems;
    if (typeof d.bytesTotal === 'number' && d.bytesTotal > 0) st.bytesTotal = d.bytesTotal;
    this._render(st);
  }

  _onProgress(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    if (typeof d.bytesDone === 'number') st.bytesDone = d.bytesDone;
    this._render(st);
  }

  _onPhase(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    if (d.label) st.labelEl.textContent = String(d.label);
    st.row.classList.add('indet');
  }

  _onRows(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    if (typeof d.written === 'number') st.written = d.written;
    this._render(st);
  }

  _onComplete(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    st.row.classList.remove('indet');
    st.row.classList.add('ok');
    st.pctEl.textContent = '100 %';
    st.fill.style.width = '100%';
    st.labelEl.textContent = '✔ terminé — ' + st.written + ' lignes';
    var self = this;
    st.timer = setTimeout(function () { self._drop(d.importId); }, 3000);
  }

  _onError(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    st.row.classList.remove('indet');
    st.row.classList.add('err');
    st.pctEl.textContent = '✗';
    st.labelEl.textContent = String((d.message || 'erreur import')).slice(0, 80);
    var self = this;
    st.timer = setTimeout(function () { self._drop(d.importId); }, 6000);
  }

  _onAborted(e) {
    var d = e && e.detail;
    if (!d) return;
    var st = this._lines.get(d.importId);
    if (!st) return;
    st.row.classList.remove('indet');
    st.pctEl.textContent = 'abandonné';
    var self = this;
    st.timer = setTimeout(function () { self._drop(d.importId); }, 3000);
  }

  // ————— rendu —————

  _render(st) {
    // priorité : % de lignes (total connu via IMPORT_META, mode global Xtream),
    // sinon % d'octets (Content-Length : M3U/XMLTV), sinon indéterminé animé.
    var pct = -1;
    if (st.totalItems > 0) {
      pct = Math.min(99, Math.floor((st.written / st.totalItems) * 100));
      st.pctEl.textContent = pct + ' % — ' + st.written + '/' + st.totalItems;
    } else if (st.bytesTotal > 0) {
      pct = Math.min(99, Math.floor((st.bytesDone / st.bytesTotal) * 100));
      st.pctEl.textContent = pct + ' % — ' + fmtBytes(st.bytesDone) + '/' + fmtBytes(st.bytesTotal);
    }
    if (pct < 0) {
      st.pctEl.textContent = st.written > 0 ? st.written + ' lignes' : '…';
      return;
    }
    st.fill.style.width = String(pct) + '%';
  }

  _drop(importId) {
    var st = this._lines.get(importId);
    if (!st) return;
    this._lines.delete(importId);
    if (st.timer) clearTimeout(st.timer);
    if (st.row.parentNode) st.row.parentNode.removeChild(st.row);
  }
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' Mo';
  if (n >= 1024) return Math.round(n / 1024) + ' Ko';
  return n + ' o';
}
