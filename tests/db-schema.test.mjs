// tests/db-schema.test.mjs — migration V19 : index secondaire minimal.
import test from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { db, freshDb } from './helpers/dbx.mjs';

test('V19 : channels/vod/series ne conservent que importId comme index secondaire', async () => {
  await freshDb();

  for (const name of ['channels', 'vod', 'series']) {
    const schema = db.table(name).schema;
    assert.equal(schema.primKey.name, 'id');
    assert.deepEqual(schema.indexes.map(function (index) { return index.name; }), ['importId'], name);
  }

  assert.deepEqual(
    db.table('epg').schema.indexes.map(function (index) { return index.name; }),
    ['[importId+channelId+startTime]', 'importId', 'stopTime'],
    'EPG conserve ses index fonctionnels (fenêtre chronologique + rétention)'
  );
  assert.deepEqual(
    db.table('categories').schema.indexes.map(function (index) { return index.name; }),
    ['importId', '[importId+kind]'],
    'categories conserve le parcours dans l’ordre serveur'
  );
});

test('V19 : la migration V3 vers V4 conserve les lignes et leurs propriétés', async () => {
  await db.delete();

  const legacy = new Dexie('IPTVDatabase');
  legacy.version(1).stores({
    playlists: '++id, name, activeImportId, activeEpgImportId, updatedAt',
    imports: '++id, playlistId, kind, status, createdAt',
    channels: 'id, importId, [importId+groupName], channelId, searchName',
    epg: 'id, [importId+channelId+startTime], importId, stopTime'
  });
  legacy.version(2).stores({
    vod: 'id, importId, [importId+groupName], searchName'
  });
  legacy.version(3).stores({
    series: 'id, importId, [importId+groupName], searchName',
    series_info: 'id, importId',
    categories: '++cid, importId, [importId+kind]'
  });
  await legacy.open();
  await legacy.channels.add({
    id: 'legacy:1', importId: 'legacy', groupName: 'Ancien', channelId: 'c1',
    searchName: 'ancien', name: 'Chaîne ancienne'
  });
  await legacy.close();

  await db.open();
  const row = await db.channels.get('legacy:1');
  assert.equal(row.groupName, 'Ancien');
  assert.equal(row.searchName, 'ancien');
  assert.deepEqual(db.table('channels').schema.indexes.map(function (index) { return index.name; }), ['importId']);
});
