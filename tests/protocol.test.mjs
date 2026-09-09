// tests/protocol.test.mjs — PROT-6 (double déclenchement), abort en cours,
// abort pendant watermark (waiter libéré, promesse rejetée), PROT-2 (ack tardif),
// filet worker.onerror → failImport avec importId injecté.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db, makePair, addImportRow, addPlaylist } from './helpers/dbx.mjs';
import { buildM3U, routeText } from './helpers/fixtures.mjs';

test('PROT-6 : second startImport rejeté immédiatement, premier intact', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'P6');
  const url = 'http://fixtures.test/busy.m3u';
  routeText(url, buildM3U(50, 2, {}), { delayMs: 50 }); // retarde la pompe pour garder l'import en vol

  const pair = makePair('m3u', 'channels');
  const imp1 = await addImportRow(db, plId, 'playlist');
  const p1 = pair.controller.startImport({ importId: imp1, playlistId: plId, kind: 'playlist', url: url });

  const imp2 = await addImportRow(db, plId, 'playlist');
  await assert.rejects(
    pair.controller.startImport({ importId: imp2, playlistId: plId, kind: 'playlist', url: url }),
    /BUSY/
  );
  await p1;
  assert.equal((await db.imports.get(imp1)).status, 'completed');
  assert.equal(await db.channels.where('importId').equals(imp1).count(), 50);
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('abort en cours (via PlaylistManager) : pas de swap, status failed, lignes partielles purgées, worker débloqué', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'PA');
  const url = 'http://fixtures.test/abort.m3u';
  // gros fichier + acks réalistes : on abort dès le premier CHUNK écrit
  routeText(url, buildM3U(20000, 40, {}), { chunkSize: 64 * 1024 });

  const pair = makePair('m3u', 'channels');
  const { PlaylistManager } = await import('../src/services/PlaylistManager.js');
  const manager = new PlaylistManager({ get: () => pair });
  const importId = await addImportRow(db, plId, 'playlist');

  let firstChunkWritten = false;
  let aborted = false;
  const origProcess = pair.dataManager._processChunk.bind(pair.dataManager);
  pair.dataManager._processChunk = async function (msg) {
    await origProcess(msg);
    if (!aborted) { aborted = true; manager.abort(plId, 'playlist'); }
  };

  const p = pair.controller.startImport({ importId: importId, playlistId: plId, kind: 'playlist', url: url });
  await assert.rejects(p, /IMPORT_ABORTED/);

  await new Promise(r => setTimeout(r, 150)); // laisser la pompe/worker se solder
  const pl = await db.playlists.get(plId);
  assert.notEqual(pl.activeImportId, importId, 'aucun swap');
  const imp = await db.imports.get(importId);
  assert.equal(imp.status, 'failed', 'marqué failed');
  assert.equal(await db.channels.where('importId').equals(importId).count(), 0,
    'lignes partielles purgées (PROT-5 + write d’annulation)');

  // worker débloqué : un nouvel import passe sur la même paire
  const imp2 = await addImportRow(db, plId, 'playlist');
  routeText('http://fixtures.test/after.m3u', buildM3U(10, 2, {}));
  await pair.controller.startImport({ importId: imp2, playlistId: plId, kind: 'playlist', url: 'http://fixtures.test/after.m3u' });
  assert.equal(await db.channels.where('importId').equals(imp2).count(), 10);

  pair.controller.destroy(); pair.dataManager.destroy();
});

test('watermark : waiter suspendu libéré à teardown → resolve(false), jamais figé', async () => {
  await freshDb();
  const pair = makePair('m3u', 'channels');
  pair.controller.currentImportId = 42;
  pair.controller.inflightText = 4; // slots pleins
  const waiting = pair.controller._awaitSlotOrAborted(42);
  pair.controller._teardown();       // abort/terminaison → libère les waiters
  assert.equal(await waiting, false, 'sortie propre : plus de pompe');
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('PROT-2 : CHUNK_COMMITTED d’un import mort ignoré par le worker epg', async () => {
  // worker seul : on vérifie qu’un ack avec mauvais importId ne déclenche aucun flush
  await freshDb();
  const { FakeWorker, WORKERS } = await import('./helpers/workerHost.mjs');
  const w = new FakeWorker(WORKERS.epg);
  const seen = [];
  w.onmessage = (ev) => seen.push(ev.data.type);
  w.postMessage({ type: 'INIT_IMPORT', importId: 1, playlistId: 1, kind: 'epg' });
  await new Promise(r => setTimeout(r, 10));
  w.postMessage({ type: 'CHUNK_COMMITTED', importId: 999 }); // importId ≠ 1 → ignoré
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(seen, [], 'aucun message émis suite à l’ack tardif');
});

test('filet worker.onerror (crash worker) : failImport avec importId injecté', async () => {
  await freshDb();
  const pair = makePair('m3u', 'channels');
  const plId = await addPlaylist(db, 'PC');
  const importId = await addImportRow(db, plId, 'playlist');
  pair.controller.currentImportId = importId;

  const errSeen = new Promise(function (resolve) {
    window.addEventListener('import-error', function h(e) {
      if (e.detail && e.detail.importId === importId) {
        window.removeEventListener('import-error', h);
        resolve(e.detail);
      }
    });
  });

  // simulation du crash : le bootstrap branche worker.onerror → failImport(controller.currentImportId)
  pair.dataManager.failImport(pair.controller.currentImportId, new Error('worker died'));

  const imp = await db.imports.get(importId);
  assert.equal(imp.status, 'failed');
  const detail = await errSeen;
  assert.match(detail.message, /worker died/, 'événement import-error avec importId courant');
  pair.controller.destroy(); pair.dataManager.destroy();
});
