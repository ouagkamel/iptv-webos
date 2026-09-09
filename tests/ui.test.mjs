// tests/ui.test.mjs — invariant §1.2-6 (VirtualList : nœuds rendus bornés sur
// 20 000 items), rendu XSS-safe, FocusEngine (navigation circulaire, activation
// data-index, pile LIFO Back + repli platformBack).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { VirtualList } from '../src/ui/VirtualList.js';
import { FocusEngine } from '../src/ui/FocusEngine.js';

function withDom(fn) {
  const dom = makeDom();
  const prev = globalThis.document;
  globalThis.document = dom.document;
  try { return fn(dom); } finally { globalThis.document = prev; }
}

test('VirtualList : ≤ _maxNodes() quel que soit le scroll sur 20 000 items', () => {
  withDom((dom) => {
    const container = dom.createElement('div');
    container.clientHeight = 600;
    const list = new VirtualList(container, { itemHeight: 60, overscan: 4 });
    list.mount();
    const items = [];
    for (let i = 0; i < 20000; i++) items.push({ name: 'Chaîne ' + (i + 1) });
    list.setItems(items);

    const cap = list._maxNodes(); // ceil(600/60)+8+1 = 19
    assert.equal(cap, 19);
    const positions = [0, 1000, 30000, 599 * 60, 20000 * 60 - 600];
    for (const top of positions) {
      container.scrollTop = top;
      list._renderWindow();
      assert.ok(list.getRenderedNodeCount() <= cap,
        'invariant §1.2-6 violé à scrollTop=' + top + ' → ' + list.getRenderedNodeCount());
    }
    // spacer dimensionné pour l'ascenseur complet
    assert.equal(list.spacer.style.height, (20000 * 60) + 'px');
    list.destroy();
    assert.equal(list.pool.length, 0);
  });
});

test('VirtualList : rendu textContent strict (XSS-safe, jamais innerHTML)', () => {
  withDom(() => {
    const container = makeDom().createElement('div');
    const list = new VirtualList(container, { itemHeight: 60, overscan: 2 });
    list.mount();
    list.setItems([{ name: '<img src=x onerror=alert(1)>' }]);
    const row = list.pool[0];
    assert.equal(row.firstChild.textContent, '<img src=x onerror=alert(1)>',
      'le nom est du TEXTE, pas du HTML');
    assert.equal(row.getAttribute('data-index'), '0');
  });
});

test('FocusEngine : navigation circulaire + activation data-index + OK=case 13', () => {
  const dom = makeDom();
  const prev = globalThis.document;
  globalThis.document = dom.document;
  try {
    const engine = new FocusEngine();
    engine.init();
    const mk = (i) => { const el = dom.createElement('div'); el.setAttribute('data-index', String(i)); el.tabIndex = -1; return el; };
    const els = [mk(0), mk(1), mk(2)];
    engine.setFocusables(els);

    let activated = [];
    window.addEventListener('focus-activate', function h(e) { activated.push(e.detail.index); });

    engine.handleKeyDown({ keyCode: 40, preventDefault() {} }); // -1+1 → 0
    assert.equal(engine.currentIndex, 0);
    engine.handleKeyDown({ keyCode: 40, preventDefault() {} }); // → 1
    engine.handleKeyDown({ keyCode: 38, preventDefault() {} }); // → 0
    engine.handleKeyDown({ keyCode: 38, preventDefault() {} }); // wrap → 2
    assert.equal(engine.currentIndex, 2);
    engine.handleKeyDown({ keyCode: 13, preventDefault() {} });  // OK
    assert.deepEqual(activated, [2], 'focus-activate avec data-index (pas l’index du pool)');

    engine.destroy();
    engine.handleKeyDown({ keyCode: 40 }); // post-destroy inerte
    assert.equal(engine.currentIndex, 2, 'détruit : plus d’effet');
  } finally { globalThis.document = prev; }
});

test('FocusEngine : pile LIFO des back handlers, repli platformBack SDK', () => {
  let platformBackCalls = 0;
  window.webOS = { platformBack: () => { platformBackCalls += 1; } };
  const engine = new FocusEngine();
  const closed = [];
  const h1 = () => closed.push('osd');
  const h2 = () => closed.push('modal');
  engine.pushBackHandler(h1);
  engine.pushBackHandler(h2);
  engine.handleSystemBack();             // LIFO → modal d'abord (le modal se ferme lui-même)
  assert.deepEqual(closed, ['modal']);
  engine.removeBackHandler(h2);          // s'auto-dépile à sa fermeture (contrat §8.1)
  engine.handleSystemBack();             // → OSD
  engine.removeBackHandler(h1);
  engine.handleSystemBack();             // pile vide → main rendue à webOS
  assert.deepEqual(closed, ['modal', 'osd']);
  assert.equal(platformBackCalls, 1, 'repli platformBack quand la pile est vide');
  engine.destroy();
  delete window.webOS;
});

test('Magic Remote : hystérésis 5 px — micro-tremblements ignorés, mouvement réel activé', () => {
  const dom = makeDom();
  const prev = globalThis.document;
  globalThis.document = dom.document;
  try {
    const engine = new FocusEngine();
    engine.handleMouseMove({ clientX: 100, clientY: 100 }); // init sans activation
    engine.handleMouseMove({ clientX: 103, clientY: 102 }); // < seuil
    assert.ok(!dom.document.body.classList.contains('magic-remote-active'), 'tremblement ignoré');
    engine.handleMouseMove({ clientX: 140, clientY: 140 }); // > seuil
    assert.ok(dom.document.body.classList.contains('magic-remote-active'));
    engine.handleKeyDown({ keyCode: 40, preventDefault() {} }); // clavier → mode nav
    assert.ok(!dom.document.body.classList.contains('magic-remote-active'));
  } finally { globalThis.document = prev; }
});
