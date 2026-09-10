// tests/list-order.test.mjs — V13 §5.3 : ordre d'affichage/zap = ordre du
// serveur (rang de catégorie, puis sortIdx), et JAMAIS l'ordre lexicographique
// des clés `importId:id`. Couvre le tri pur + les lectures du PlaylistManager
// sur vrais imports (mode global ET repli par catégories) + M3U.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRows } from '../src/services/ListOrder.js';
import { freshDb, db, makePair, addPlaylist, addImportRow } from './helpers/dbx.mjs';
import { XTREAM_PANEL, routeXtreamPanel } from './helpers/fixtures.mjs';

const BASE = 'http://panel.test';
const USER = 'u1';
const PASS = 'p@ss w/';

test('orderRows : pur — rang catégorie, sortIdx, inconnus en fin, déterministe', () => {
  const rows = [
    { id: '1:10', name: 'A', groupName: 'Sports', sortIdx: 3 },
    { id: '1:2', name: 'B', groupName: 'Infos', sortIdx: 0 },
    { id: '1:1000', name: 'C', groupName: 'Infos', sortIdx: 1 },
    { id: '1:99', name: 'D', groupName: 'Orphelin', sortIdx: 2 },
    { id: '1:3', name: 'E', groupName: 'Sports', sortIdx: 2 }
  ];
  const out = orderRows(rows, ['Infos', 'Sports']);
  assert.deepEqual(out.map(function (r) { return r.name; }), ['B', 'C', 'E', 'A', 'D'],
    'catégories d’abord dans l’ordre serveur, sortIdx dans chaque catégorie, inconnu en fin');
  // immutabilité : l’entrée n’est pas réordonnée
  assert.equal(rows[0].name, 'A');
  assert.deepEqual(orderRows([], ['X']), []);
  assert.deepEqual(orderRows([{ id: 'z', name: 'z' }], null)[0].name, 'z', 'mono-ligne + cats nulles');
});

test('V13 lecture channels : mode global — ordre du panneau, pas l’ordre des clés', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'OrdG', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, {});
  const { setRoute } = await import('./helpers/fetchRouter.mjs');
  const api = BASE + '/player_api.php?username=' + encodeURIComponent(USER) + '&password=' + encodeURIComponent(PASS);
  // catalogue entrelacé, stream_id non croissants : l’ordre des clés donnerait
  // 10,1000,2,201,99 ; l’ordre serveur (rang catégorie puis position) :
  // S99,S10,S2,S1000 (cat 10 dans l’ordre du tableau) puis S201 (cat 20)
  const interleaved = [
    { stream_id: '99', name: 'S99', epg_channel_id: null, stream_icon: '', category_id: '10' },
    { stream_id: '201', name: 'S201', epg_channel_id: null, stream_icon: '', category_id: '20' },
    { stream_id: '10', name: 'S10', epg_channel_id: null, stream_icon: '', category_id: '10' },
    { stream_id: '2', name: 'S2', epg_channel_id: null, stream_icon: '', category_id: '10' },
    { stream_id: '1000', name: 'S1000', epg_channel_id: null, stream_icon: '', category_id: '10' }
  ];
  setRoute(api + '&action=get_live_streams', interleaved);
  const pair = makePair('xtream', 'channels');
  await pair.controller.startImport({ source: 'xtream', importId: importId, playlistId: plId,
                                     kind: 'playlist', base: BASE, username: USER, password: PASS });

  const { PlaylistManager } = await import('../src/services/PlaylistManager.js');
  const manager = new PlaylistManager({ get: function () { return pair; } });
  const chans = await manager.channels(plId);
  assert.deepEqual(chans.map(function (c) { return c.name; }),
    ['S99', 'S10', 'S2', 'S1000', 'S201'], 'ordre serveur (position d’arrivée, catégorie d’abord)');
  assert.deepEqual(chans.map(function (c) { return c.sortIdx; }), [0, 2, 3, 4, 1],
    'sortIdx = position d’arrivée dans le catalogue du panneau');

  // repli par catégories : même ordre d’affichage (boucle dans l’ordre des catégories)
  const vod = await manager.vod(plId);
  assert.deepEqual(vod.map(function (v) { return v.name; }),
    ['Film Alpha', 'Film Beta', 'Film Gamma', 'Chaîne Café VOD'], 'vod : ordre de la catégorie unique');
  const series = await manager.series(plId);
  assert.deepEqual(series.map(function (x) { return x.name; }),
    ['Série Alpha', 'Série Beta', 'Série Gamma', 'Doc Un', 'Doc Deux'], 'séries : Ser. US puis Docs TV');
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('V13 lecture channels : mode repli (failGlobal) — même ordre que le mode global', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'OrdF', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, { failGlobal: true });
  const pair = makePair('xtream', 'channels');
  await pair.controller.startImport({ source: 'xtream', importId: importId, playlistId: plId,
                                     kind: 'playlist', base: BASE, username: USER, password: PASS });
  const { PlaylistManager } = await import('../src/services/PlaylistManager.js');
  const manager = new PlaylistManager({ get: function () { return pair; } });
  const chans = await manager.channels(plId);
  assert.deepEqual(chans.map(function (c) { return c.name; }),
    ['News 24', 'Matin TV', 'Soir Live', 'Football Arena', 'Tennis Club'],
    'repli : catégories du serveur dans leur ordre, items dans l’ordre de chaque liste');
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('V13 M3U : sortIdx = ordre du fichier (les clés triées ne doivent pas percer)', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'OrdM3U');
  const importId = await addImportRow(db, plId, 'playlist');
  const { buildM3U, routeText } = await import('./helpers/fixtures.mjs');
  const url = 'http://fixtures.test/ord.m3u';
  routeText(url, buildM3U(30, 5, {}));
  const pair = makePair('m3u', 'channels');
  await pair.controller.startImport({ importId: importId, playlistId: plId, kind: 'playlist', url: url });
  const { PlaylistManager } = await import('../src/services/PlaylistManager.js');
  const manager = new PlaylistManager({ get: function () { return pair; } });
  const chans = await manager.channels(plId);
  assert.equal(chans.length, 30);
  // Règle V13 : rang de catégorie d’abord (première apparition dans le fichier),
  // puis position dans la catégorie. buildM3U alterne Groupe 0..4 → chaque
  // groupe revient tous les 5 items : sortIdx 0,5,10,15,20 | 1,6,… | …
  const expect = [];
  for (let g = 0; g < 5; g++) for (let k = 0; k < 6; k++) expect.push(g + 5 * k);
  assert.deepEqual(chans.map(function (c) { return c.sortIdx; }), expect,
    'catégories dans l’ordre du fichier, positions conservées dans chaque groupe');
  const groups = chans.map(function (c) { return c.groupName; });
  assert.deepEqual(groups.slice(0, 6), new Array(6).fill(groups[0]), 'contiguïté par groupe');
  pair.controller.destroy(); pair.dataManager.destroy();
});
