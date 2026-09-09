// tests/xtream.test.mjs — fixtures §9 V9 : xtream-mock (5 channels + 4 vod exacts,
// ACCOUNT_INFO maxConnections=2), xtream-auth-fail (erreur typée, zéro écriture),
// catégorie défaillante ignorée (XP-4), clés DB-5 + searchName, XtreamClient.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db, makePair, addImportRow, addPlaylist } from './helpers/dbx.mjs';
import { XTREAM_PANEL, routeXtreamPanel } from './helpers/fixtures.mjs';
import { XtreamClient } from '../src/platform/XtreamClient.js';

const BASE = 'http://panel.test';
const USER = 'u1';
const PASS = 'p@ss w/';

function normalizeSearchName(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function runXtream(overrides) {
  await freshDb();
  const plId = await addPlaylist(db, 'Xt', {
    source: 'xtream', base: BASE, username: USER, password: PASS
  });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, overrides);

  const pair = makePair('xtream', 'channels');
  const accountInfos = [];
  pair.dataManager.addAuxListener(function (d) {
    if (d && d.type === 'ACCOUNT_INFO') accountInfos.push(d);
  });

  const detail = await pair.controller.startImport({
    source: 'xtream', importId: importId, playlistId: plId, kind: 'playlist',
    base: BASE, username: USER, password: PASS
  });
  return { plId, importId, detail, pair, accountInfos };
}

test('xtream-mock : 5 channels + 4 vod exacts, swap actif, ACCOUNT_INFO maxConnections=2', async () => {
  const r = await runXtream();
  assert.equal(await db.channels.where('importId').equals(r.importId).count(), XTREAM_PANEL.EXPECTED.channels);
  assert.equal(await db.vod.where('importId').equals(r.importId).count(), XTREAM_PANEL.EXPECTED.vod);

  assert.equal(r.accountInfos.length, 1, 'ACCOUNT_INFO routé via _routeAux');
  assert.equal(r.accountInfos[0].maxConnections, 2);

  const pl = await db.playlists.get(r.plId);
  assert.equal(pl.activeImportId, r.importId, 'swap actif (kind playlist)');
  assert.equal((await db.imports.get(r.importId)).status, 'completed');

  // mapping live : channelId = epg_channel_id, groupName = catégorie, URL de lecture
  const chans = {}; (await db.channels.where('importId').equals(r.importId).toArray())
    .forEach(x => { chans[x.name] = x; });
  const vods = {}; (await db.vod.where('importId').equals(r.importId).toArray())
    .forEach(x => { vods[x.name] = x; });

  const news = chans['News 24'];
  assert.equal(news.channelId, 'news24.example');
  assert.equal(news.groupName, 'Infos');
  assert.equal(news.streamUrl, BASE + '/live/' + encodeURIComponent(USER) + '/' + encodeURIComponent(PASS) + '/101.m3u8');
  assert.equal(chans['Football Arena'].groupName, 'Sports');

  // mapping vod : extension conteneur respectée + défaut mp4, searchName DB-3
  assert.ok(vods['Film Alpha'].streamUrl.endsWith('/901.mkv'));
  assert.ok(vods['Film Gamma'].streamUrl.endsWith('/903.mp4'), 'container_extension absent → mp4');
  assert.equal(vods['Chaîne Café VOD'].searchName, normalizeSearchName('Chaîne Café VOD'));

  // DB-5 : la VOD n'est JAMAIS dans channels et réciproquement
  assert.equal(Object.keys(vods).length, 4);
  assert.ok(Object.keys(chans).every(k => k.startsWith('News') || k.startsWith('Matin') || k.startsWith('Soir') || k.startsWith('Football') || k.startsWith('Tennis')),
    'aucun film dans channels');

  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xtream-auth-fail : XTREAM_AUTH_FAILED terminal, zéro écriture, aucun swap', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'XtKO', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, { account: { user_info: { status: 'Expired' } } });

  const pair = makePair('xtream', 'channels');
  await assert.rejects(
    pair.controller.startImport({
      source: 'xtream', importId: importId, playlistId: plId, kind: 'playlist',
      base: BASE, username: USER, password: PASS
    }),
    /XTREAM_AUTH_FAILED/
  );
  assert.equal(await db.channels.count(), 0, 'zéro écriture (XP-1)');
  assert.equal(await db.vod.count(), 0);
  const pl = await db.playlists.get(plId);
  assert.notEqual(pl.activeImportId, importId, 'pas de swap');
  assert.equal((await db.imports.get(importId)).status, 'failed');
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('XP-4 : catégorie live défaillante → ignorée, import complété avec le reste', async () => {
  const r = await runXtream({ failLiveCat: '20' });
  assert.equal(await db.channels.where('importId').equals(r.importId).count(), 3, 'catégorie 20 ignorée');
  assert.equal(await db.vod.where('importId').equals(r.importId).count(), 4, 'vod intacte');
  assert.equal((await db.imports.get(r.importId)).status, 'completed');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('XtreamClient : validation base + endpoints + xmltv (EPG pipeline §6 inchangé)', () => {
  assert.equal(XtreamClient.normalizeBase('https://my.panel:25461///'), 'https://my.panel:25461');
  assert.throws(() => XtreamClient.normalizeBase('ftp://nope'), /XTREAM_BASE_URL_INVALID/);
  assert.equal(
    XtreamClient.listUrl('http://p', 'u', 'pw', 'get_live_streams', 7),
    'http://p/player_api.php?username=u&password=pw&action=get_live_streams&category_id=7'
  );
  assert.equal(XtreamClient.epgXmltvUrl('http://p', 'u', 'pw'), 'http://p/xmltv.php?username=u&password=pw');
  assert.equal(XtreamClient.vodStreamUrl('http://p', 'u', 'pw', 5), 'http://p/movie/u/pw/5.mp4');
});

test('bascule de table live→vod : jamais de CHUNK mixte (chaque lot porte UNE targetTable)', async () => {
  // 500+ streams live pour forcer plusieurs CHUNK ; le premier lot vod doit être
  // un CHUNK 'vod' séparé. On épie les messages worker→DataManager.
  await freshDb();
  const plId = await addPlaylist(db, 'XtT', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');

  // panneau modifié : catégorie live de 501 streams
  const bigLive = [];
  for (let i = 0; i < 501; i++) bigLive.push({ stream_id: '1000' + i, name: 'L' + i, epg_channel_id: null, stream_icon: '' });
  routeXtreamPanel(BASE, USER, PASS, {});
  const { setRoute } = await import('./helpers/fetchRouter.mjs');
  const api = BASE + '/player_api.php?username=' + encodeURIComponent(USER) + '&password=' + encodeURIComponent(PASS);
  setRoute(api + '&action=get_live_streams&category_id=10', bigLive);

  const { FakeWorker, WORKERS } = await import('./helpers/workerHost.mjs');
  const worker = new FakeWorker(WORKERS.xtream);
  const seenTables = [];
  const { DataManager } = await import('../src/data/DataManager.js');
  const { ImportController } = await import('../src/data/ImportController.js');
  const dm = new DataManager(worker, 'channels');
  const orig = dm._processChunk.bind(dm);
  dm._processChunk = async function (msg) { seenTables.push(msg.targetTable); return orig(msg); };
  const controller = new ImportController(worker, dm);

  await controller.startImport({ source: 'xtream', importId, playlistId: plId, kind: 'playlist',
                                 base: BASE, username: USER, password: PASS });
  const uniq = Array.from(new Set(seenTables));
  assert.deepEqual(uniq.sort(), ['channels', 'vod'], 'deux tables vues, par lots séparés');
  assert.equal(await db.channels.where('importId').equals(importId).count(), 503, '501 (cat 10) + 2 (cat 20)');
  controller.destroy(); dm.destroy();
});
