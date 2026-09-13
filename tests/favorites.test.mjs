// tests/favorites.test.mjs — V23 : favoris persistants par playlist, sans mélange entre profils.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db, addPlaylist } from './helpers/dbx.mjs';
import { PlaylistManager } from '../src/services/PlaylistManager.js';

test('favoris : schéma borné et indexé par playlist / type / clé source', async () => {
  await freshDb();
  const schema = db.table('favorites').schema;
  assert.equal(schema.primKey.name, 'id');
  assert.deepEqual(schema.indexes.map(function (index) { return index.name; }), [
    'playlistId', 'kind', 'sourceKey', '[playlistId+kind+sourceKey]', 'createdAt', 'updatedAt'
  ]);
});

test('favoris : suppression d’une playlist supprime ses snapshots sans toucher au profil voisin', async () => {
  await freshDb();
  const first = await addPlaylist(db, 'Salon', { source: 'm3u' });
  const second = await addPlaylist(db, 'Chambre', { source: 'm3u' });
  await db.favorites.bulkAdd([
    { playlistId: first, kind: 'live', sourceKey: 'channel:c1', name: 'Chaîne A', createdAt: 1, updatedAt: 1 },
    { playlistId: second, kind: 'vod', sourceKey: 'vod:42', name: 'Film B', createdAt: 2, updatedAt: 2 }
  ]);

  const manager = new PlaylistManager({ get: function () { return null; } });
  await manager.remove(first);

  assert.equal(await db.favorites.where('playlistId').equals(first).count(), 0);
  assert.equal(await db.favorites.where('playlistId').equals(second).count(), 1);
  assert.equal(await db.playlists.get(second).then(function (row) { return row.name; }), 'Chambre');
});

test('favoris : maintenance purge les snapshots orphelins', async () => {
  await freshDb();
  await db.favorites.add({ playlistId: 9999, kind: 'series', sourceKey: 'series:1', name: 'Orpheline', createdAt: 1, updatedAt: 1 });
  const manager = new PlaylistManager({ get: function () { return null; } });
  await manager.bootMaintenance();
  assert.equal(await db.favorites.count(), 0);
});
