// tests/helpers/hlsStub.mjs — stub hls.js : instance contrôlable par les tests.
// Statique : tests lisent les instances créées via __hlsInstances.
export const __hlsInstances = [];

export default class Hls {
  constructor(config) {
    this.config = config;
    this._handlers = {};
    this._source = null;
    this._media = null;
    this.destroyed = false;
    this.startLoadCalls = 0;
    this.recoverCalls = 0;
    __hlsInstances.push(this);
  }
  on(evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); }
  emit(evt, data) { (this._handlers[evt] || []).forEach(function (f) { f(evt, data); }); }
  loadSource(u) { this._source = u; }
  attachMedia(m) { this._media = m; }
  startLoad(n) { this.startLoadCalls += 1; this.startLoadArg = n; }
  recoverMediaError() { this.recoverCalls += 1; }
  destroy() { this.destroyed = true; }
  static isSupported() { return Hls.__supported !== false; }
}

Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
Hls.ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
Hls.__supported = true;
