// tests/default-playlist.test.mjs — playlist Xtream préremplie au premier boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db } from './helpers/dbx.mjs';
import { PlaylistManager } from '../src/services/PlaylistManager.js';
import { DEFAULT_PLAYLIST } from '../src/config.js';

test('playlist par défaut : créée une seule fois et sélectionnable sans saisie', async () => {
  await freshDb();
  const manager = new PlaylistManager({ get: function () { return null; } });
  const id1 = await manager.ensureDefaultPlaylist(DEFAULT_PLAYLIST);
  const id2 = await manager.ensureDefaultPlaylist(DEFAULT_PLAYLIST);
  const rows = await db.playlists.toArray();
  assert.equal(id1, id2, 'second boot retrouve la même playlist');
  assert.equal(rows.length, 1, 'aucun doublon');
  assert.equal(rows[0].source, 'xtream');
  assert.equal(rows[0].base, 'http://kdfgh.com:8080');
  assert.equal(rows[0].username, 'qmjexhtx');
  assert.equal(rows[0].password, 'rskxknar');
});
