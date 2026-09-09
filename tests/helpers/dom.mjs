// tests/helpers/dom.mjs — mini-DOM pour VirtualList / PlayerOSD / FocusEngine.
// Suffisant pour l'invariant §1.2-6 (nœuds rendus) et le wiring d'événements.
export function makeDom() {
  function makeClassList(el) {
    const set = new Set();
    return {
      add: function (c) { set.add(c); el._classes = Array.from(set).join(' '); },
      remove: function (c) { set.delete(c); el._classes = Array.from(set).join(' '); },
      contains: function (c) { return set.has(c); }
    };
  }

  function createElement(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [], parentNode: null,
      style: {}, attrs: {}, _listeners: {},
      tabIndex: 0, _text: '',
      classList: null,
      firstChild: null,
      clientHeight: 600, scrollTop: 0,
      focused: false,
      appendChild: function (c) {
        c.parentNode = el; el.children.push(c); el._syncFirstChild(); return c;
      },
      removeChild: function (c) {
        const i = el.children.indexOf(c);
        if (i !== -1) el.children.splice(i, 1);
        c.parentNode = null; el._syncFirstChild(); return c;
      },
      _syncFirstChild: function () { el.firstChild = el.children.length ? el.children[0] : null; },
      setAttribute: function (k, v) { el.attrs[k] = String(v); },
      getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      addEventListener: function (t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
      removeEventListener: function (t, fn) {
        const a = el._listeners[t] || []; const i = a.indexOf(fn); if (i !== -1) a.splice(i, 1);
      },
      dispatch: function (t, ev) { (el._listeners[t] || []).forEach(function (f) { f(ev || { type: t }); }); },
      focus: function () { el.focused = true; },
      scrollIntoView: function () { el._scrolled = true; },
      querySelectorAll: function () { return []; },
      get textContent() { return el._text; },
      set textContent(v) { el._text = String(v); el.children = []; el._syncFirstChild(); },
      set innerHTML(v) { el.children = []; el._text = ''; el._syncFirstChild(); }
    };
    el.classList = makeClassList(el);
    if (tag === 'video') {
      el.src = ''; el.paused = true; el.readyState = 0; el.currentTime = 0;
      el.play = function () { return Promise.resolve(); };
      el.load = function () {};
      el.removeAttribute = function (k) { if (k === 'src') el.src = ''; };
    }
    return el;
  }

  const body = createElement('body');
  const documentShim = {
    hidden: false,
    body: body,
    createElement: createElement,
    _listeners: {},
    addEventListener: function (t, fn) { (documentShim._listeners[t] = documentShim._listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) {
      const a = documentShim._listeners[t] || []; const i = a.indexOf(fn); if (i !== -1) a.splice(i, 1);
    },
    dispatch: function (t) { (documentShim._listeners[t] || []).forEach(function (f) { f({ type: t }); }); }
  };
  return { document: documentShim, createElement: createElement };
}
