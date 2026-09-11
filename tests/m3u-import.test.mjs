// tests/m3u-import.test.mjs — fixtures §9 : m3u-20000, duo-playlists, idempotence,
// DB-1 (clés séquentielles), DB-3 (searchName), #EXTGRP, EXTINF orphelin en fin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db, makePair, addImportRow, addPlaylist } from './helpers/dbx.mjs';
import { buildM3U, routeText } from './helpers/fixtures.mjs';

const URL_M3U = 'http://fixtures.test/master.m3u';

async function runImport(controller, pair, playlistId, importId, url) {
  const done = controller.startImport({ importId: importId, playlistId: playlistId, kind: 'playlist', url: url });
  return done;
}

test('m3u-20000 : 20 000 lignes, swap actif, groupes paginables, clés DB-1', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'Big');
  const importId = await addImportRow(db, plId, 'playlist');
  routeText(URL_M3U, buildM3U(20000, 40, { accented: true, extgrp: true, trailingExtinf: true }));

  const pair = makePair('m3u', 'channels');
  await runImport(pair.controller, pair, plId, importId, URL_M3U);

  // 20 000 + accented(1) + extgrp(1) = 20 002 ; l'EXTINF orphelin final est écarté.
  const all = await db.channels.where('importId').equals(importId).count();
  assert.equal(all, 20002, 'compte exact de lignes');

  const pl = await db.playlists.get(plId);
  assert.equal(pl.activeImportId, importId, 'activeImportId permuté');
  const imp = await db.imports.get(importId);
  assert.equal(imp.status, 'completed');

  // DB-1 : id = importId:seq, seq depuis 0, idempotent
  const first = await db.channels.get(importId + ':0');
  assert.ok(first && first.streamUrl.indexOf('http') === 0);
  const absent = await db.channels.get(importId + ':999999');
  assert.equal(absent, undefined);

  // V19 : le catalogue est filtré en mémoire après le seul index importId ;
  // groupName n'est plus un index de stockage (réduction de write amplification).
  const activeRows = await db.channels.where('importId').equals(importId).toArray();
  const g3 = activeRows.filter(function (row) { return row.groupName === 'Groupe 3'; }).length;
  assert.ok(g3 >= 500, 'groupe filtrable en mémoire après importId');

  // #EXTGRP override + DB-3 (searchName sans diacritiques) — le schéma figé
  // n'indexe ni `name` ni `searchName` : la recherche reste côté JavaScript.
  const rows = await db.channels.where('importId').equals(importId).toArray();
  const byName = {}; rows.forEach(x => { byName[x.name] = x; });
  assert.equal(byName['tv sans group'].groupName, 'Groupe EXTGRP');
  const acc = byName['Chaîne Café Événement'];
  assert.equal(acc.searchName, 'chaine cafe evenement');
  assert.equal(acc.channelId, 'accent1');

  pair.controller.destroy(); pair.dataManager.destroy();
});

test('duo-playlists : l’import B ne supprime AUCUNE ligne de A ; re-import idempotent', async () => {
  await freshDb();
  const urlA = 'http://fixtures.test/a.m3u';
  const urlB = 'http://fixtures.test/b.m3u';
  routeText(urlA, buildM3U(10, 2, {}));
  routeText(urlB, buildM3U(5, 2, {}));

  const plA = await addPlaylist(db, 'A');
  const plB = await addPlaylist(db, 'B');

  const pair = makePair('m3u', 'channels');
  const impA1 = await addImportRow(db, plA, 'playlist');
  await runImport(pair.controller, pair, plA, impA1, urlA);

  const impB = await addImportRow(db, plB, 'playlist');
  await runImport(pair.controller, pair, plB, impB, urlB);

  assert.equal(await db.channels.where('importId').equals(impA1).count(), 10, 'A intact');
  assert.equal(await db.channels.where('importId').equals(impB).count(), 5, 'B importé');

  // re-import A : swap rapide, puis GC lazy bornée à A (B reste intact).
  const impA2 = await addImportRow(db, plA, 'playlist');
  await runImport(pair.controller, pair, plA, impA2, urlA);

  assert.equal(await db.channels.where('importId').equals(impA1).count(), 10,
    'ancien import encore présent juste après le swap rapide');
  assert.equal(await db.channels.where('importId').equals(impA2).count(), 10, 'A rechargé, même compte');
  assert.equal(await db.channels.where('importId').equals(impB).count(), 5, 'B toujours intact');

  await pair.dataManager.waitForGarbageCollection();
  assert.equal(await db.channels.where('importId').equals(impA1).count(), 0, 'ancien import purgé par GC lazy');
  const oldImportRow = await db.imports.get(impA1);
  assert.equal(oldImportRow, undefined, 'ligne imports supprimée après le swap');

  pair.controller.destroy(); pair.dataManager.destroy();
});

test('terminaison avec résidu < CHUNK_ITEMS (PROT-4, V10 : lot 2000) : 1 237 lignes → COMPLETE, pas de deadlock', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'R');
  const importId = await addImportRow(db, plId, 'playlist');
  routeText(URL_M3U, buildM3U(1237, 3, {}));

  const pair = makePair('m3u', 'channels');
  await runImport(pair.controller, pair, plId, importId, URL_M3U);
  assert.equal(await db.channels.where('importId').equals(importId).count(), 1237);
  pair.controller.destroy(); pair.dataManager.destroy();
});


test('V11 catégories M3U : ordre de première apparition des group-title', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'CatM3U');
  const importId = await addImportRow(db, plId, 'playlist');
  const url = 'http://fixtures.test/cat.m3u';
  routeText(url, buildM3U(3000, 5, { extgrp: false }));
  const pair = makePair('m3u', 'channels');
  await pair.controller.startImport({ importId: importId, playlistId: plId, kind: 'playlist', url: url });
  const rows = await db.categories.where('[importId+kind]').equals([importId, 'live']).sortBy('sort');
  const names = rows.map(function (r) { return r.name; });
  assert.equal(names.length, 5, '5 groupes du panneau-fichier');
  // ordre de première apparition : buildM3U tourne Groupe (i % 5) dans l'ordre des items
  const chans = await db.channels.where('importId').equals(importId).toArray();
  const first = [];
  chans.forEach(function (c) { if (first.indexOf(c.groupName) === -1) first.push(c.groupName); });
  assert.deepEqual(names, first, 'ordre serveur (fichier) conservé, pas tri alphabétique');
  pair.controller.destroy(); pair.dataManager.destroy();
});
