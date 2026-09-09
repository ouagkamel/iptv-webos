// tests/boot-maintenance.test.mjs — §5.5 (running→failed, orphelins channels/epg/vod
// avec grace 5 min sur les imports running) + §5.6 (rétention EPG 24 h).
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db } from './helpers/dbx.mjs';
import { PlaylistManager } from '../src/services/PlaylistManager.js';

function ch(id, importId) {
  return { id: id, importId: importId, name: 'C' + id, groupName: 'G1',
           channelId: null, logo: '', streamUrl: 'http://x/' + id + '.m3u8', searchName: 'c' + id };
}
function epgRow(id, importId, channelId, start, stop) {
  return { id: id, importId: importId, channelId: channelId, startTime: start, stopTime: stop, title: 'T' };
}

test('bootMaintenance : kill d’import, orphelins purgés, running récent épargné, rétention EPG', async () => {
  await freshDb();
  const now = Date.now();

  // playlist A : import actif channels+vod ; vieil import 'running' (crash) orphelin
  const plA = await db.playlists.add({ name: 'A', updatedAt: now, activeImportId: 10, activeEpgImportId: 12 });
  await db.imports.bulkAdd([
    { id: 10, playlistId: plA, kind: 'playlist', status: 'completed', createdAt: now - 9e5 },
    { id: 11, playlistId: plA, kind: 'playlist', status: 'running', createdAt: now - 600000 },   // crash → failed
    { id: 12, playlistId: plA, kind: 'epg', status: 'completed', createdAt: now - 9e5 },
    { id: 13, playlistId: plA, kind: 'epg', status: 'running', createdAt: now - 30000 }          // récent → épargné
  ]);
  await db.channels.bulkAdd([
    ch('10:0', 10),            // actif → garde
    ch('11:0', 11),            // orphan (running ancien) → purge
    ch('99:0', 99)             // import inexistant → orphan
  ]);
  await db.vod.bulkAdd([ { ...ch('10:1', 10) }, { ...ch('11:1', 11), id: '11:1' } ]);
  await db.epg.bulkAdd([
    epgRow('12:cA:1', 12, 'cA', now - 3600e3, now + 3600e3),      // actif → garde
    epgRow('13:cB:1', 13, 'cB', now - 3600e3, now + 7200e3),      // running récent → garde
    epgRow('99:cC:1', 99, 'cC', now - 3600e3, now + 3600e3),      // orphan → purge
    epgRow('12:cD:1', 12, 'cD', now - 9e6, now - 86400000 - 1000) // expiration §5.6 → purge
  ]);

  const manager = new PlaylistManager({ get: () => null });
  await manager.bootMaintenance();

  assert.equal((await db.imports.get(11)).status, 'failed', 'running ancien → failed');
  assert.equal((await db.imports.get(13)).status, 'running', 'grace < 5 min préservée');
  assert.deepEqual((await db.channels.toArray()).map(c => c.id).sort(), ['10:0'], 'orphelins channels purgés');
  assert.deepEqual((await db.vod.toArray()).map(c => c.id), ['10:1'], 'orphelins vod purgés (DB-5)');
  const keptEpg = (await db.epg.toArray()).map(r => r.id).sort();
  assert.deepEqual(keptEpg, ['12:cA:1', '13:cB:1'], 'orphelin + expiration purgés');
});

test('bootMaintenance : idempotent sur base vide', async () => {
  await freshDb();
  const manager = new PlaylistManager({ get: () => null });
  await manager.bootMaintenance();
  assert.equal(await db.channels.count(), 0);
});
