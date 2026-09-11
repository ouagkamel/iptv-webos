// tests/import-badge.test.mjs — V10 §9 : vignette d'import (additif, non
// interactif). Les états sont pilotés par les événements window ; le DOM du
// harnais est le mini-stub de helpers/dom.mjs (asserts via références internes,
// pas de querySelector).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { ImportBadge } from '../src/components/ImportBadge.js';

function withBadge(fn) {
  const dom = makeDom();
  const prev = globalThis.document;
  globalThis.document = dom.document;
  const badge = new ImportBadge(dom.document.body);
  try { return fn(badge, dom); } finally {
    badge.destroy();
    globalThis.document = prev;
  }
}

function emit(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail: detail }));
}

test('badge : start → ligne indéterminée, rows → compteur brut', () => {
  withBadge((badge) => {
    emit('import-start', { importId: 1, kind: 'playlist' });
    const st = badge._lines.get(1);
    assert.ok(st, 'ligne créée');
    assert.ok(st.row.classList.contains('indet'), 'indéterminé sans totaux');
    assert.equal(st.pctEl.textContent, '…');
    emit('import-phase', { importId: 1, phase: 'catalogue', label: 'Téléchargement des catalogues…' });
    assert.equal(st.labelEl.textContent, 'Téléchargement des catalogues…');
    emit('import-rows', { importId: 1, written: 5, targetTable: 'channels' });
    assert.equal(st.pctEl.textContent, '5 lignes');
    assert.equal(st.labelEl.textContent, 'Téléchargement des catalogues…');
  });
});

test('badge : kind epg → libellé guide', () => {
  withBadge((badge) => {
    emit('import-start', { importId: 2, kind: 'epg' });
    assert.equal(badge._lines.get(2).labelEl.textContent, 'Import guide (EPG)');
  });
});

test('badge : meta totalItems → % de lignes ; meta bytesTotal → % octets en repli', () => {
  withBadge((badge) => {
    emit('import-start', { importId: 3, kind: 'playlist' });
    emit('import-meta', { importId: 3, totalItems: 200 });
    emit('import-rows', { importId: 3, written: 100 });
    const st = badge._lines.get(3);
    assert.equal(st.pctEl.textContent, '50 % — 100/200');
    assert.equal(st.fill.style.width, '50%');

    emit('import-start', { importId: 4, kind: 'epg' });
    emit('import-meta', { importId: 4, bytesTotal: 1000 });
    emit('import-progress', { importId: 4, bytesDone: 100 });
    const st4 = badge._lines.get(4);
    assert.equal(st4.pctEl.textContent, '10 % — 100 o/1000 o');
    assert.equal(st4.fill.style.width, '10%');
    // priorité lignes si les deux sont connus
    emit('import-meta', { importId: 4, totalItems: 10 });
    emit('import-rows', { importId: 4, written: 10 });
    assert.equal(st4.pctEl.textContent, '99 % — 10/10', 'borné à 99 % tant que non complete');
  });
});

test('badge : complete → ✔ + n lignes ; error → ✗ message ; borné à 3 lignes', () => {
  withBadge((badge) => {
    emit('import-start', { importId: 5, kind: 'playlist', profileLabel: 'Test 2 — lots 4 000' });
    emit('import-rows', { importId: 5, written: 42 });
    emit('import-complete', { importId: 5, kind: 'playlist', playlistId: 1 });
    const st = badge._lines.get(5);
    assert.ok(st.row.classList.contains('ok'));
    assert.ok(!st.row.classList.contains('indet'));
    assert.equal(st.labelEl.textContent, '✔ terminé — 42 lignes');
    emit('import-finished', { importId: 5, elapsedMs: 1234, profileLabel: 'Test 2 — lots 4 000' });
    assert.equal(st.labelEl.textContent, '✔ terminé — 42 lignes · 1.2 s · Test 2 — lots 4 000');
    assert.equal(st.pctEl.textContent, '100 %');

    emit('import-start', { importId: 6, kind: 'playlist' });
    emit('import-error', { importId: 6, message: 'XTREAM_AUTH_FAILED' });
    const st6 = badge._lines.get(6);
    assert.ok(st6.row.classList.contains('err'));
    assert.equal(st6.labelEl.textContent, 'XTREAM_AUTH_FAILED');

    for (let i = 7; i <= 10; i++) emit('import-start', { importId: i, kind: 'playlist' });
    assert.equal(badge.box.children.length, 3, 'au plus 3 lignes affichées');

    emit('import-start', { importId: 20, kind: 'epg' });
    emit('import-aborted', { importId: 20 });
    assert.equal(badge._lines.get(20).pctEl.textContent, 'abandonné');
  });
});

test('badge : événements d’un import inconnu ignorés sans lever', () => {
  withBadge((badge) => {
    emit('import-rows', { importId: 999, written: 1 });
    emit('import-progress', { importId: 999, bytesDone: 1 });
    emit('import-complete', { importId: 999 });
    assert.equal(badge.box.children.length, 0);
  });
});
