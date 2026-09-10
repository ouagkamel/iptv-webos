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
  // V10 : progression additive (meta depuis le worker, rows depuis le DataManager)
  const metaEvents = []; const rowEvents = [];
  const onMeta = function (e) { if (e.detail && e.detail.importId === importId) metaEvents.push(e.detail); };
  const onRows = function (e) { if (e.detail && e.detail.importId === importId) rowEvents.push(e.detail); };
  window.addEventListener('import-meta', onMeta); window.addEventListener('import-rows', onRows);

  const detail = await pair.controller.startImport({
    source: 'xtream', importId: importId, playlistId: plId, kind: 'playlist',
    base: BASE, username: USER, password: PASS
  });
  window.removeEventListener('import-meta', onMeta); window.removeEventListener('import-rows', onRows);
  return { plId, importId, detail, pair, accountInfos, metaEvents, rowEvents };
}

test('xtream-mock : 5 channels + 4 vod + 5 séries exacts, swap actif, ACCOUNT_INFO maxConnections=2', async () => {
  const r = await runXtream();
  assert.equal(await db.channels.where('importId').equals(r.importId).count(), XTREAM_PANEL.EXPECTED.channels);
  assert.equal(await db.vod.where('importId').equals(r.importId).count(), XTREAM_PANEL.EXPECTED.vod);
  assert.equal(await db.series.where('importId').equals(r.importId).count(), XTREAM_PANEL.EXPECTED.series);

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

  // V10 mode global = chemin par défaut : meta + rows additives observables
  assert.equal(r.metaEvents.length, 1, 'un seul import-meta');
  assert.equal(r.metaEvents[0].totalItems,
    XTREAM_PANEL.EXPECTED.channels + XTREAM_PANEL.EXPECTED.vod + XTREAM_PANEL.EXPECTED.series);
  assert.equal(r.rowEvents.length, 3, 'un CHUNK par table (jamais mixte)');
  assert.deepEqual(r.rowEvents.map(function (e) { return e.targetTable; }), ['channels', 'vod', 'series']);
  assert.equal(r.rowEvents[2].written, 14, 'cumul = total écrit');

  // mapping séries (DB-6) : catégorie serveur via Map, champs enrichis
  const series = {}; (await db.series.where('importId').equals(r.importId).toArray())
    .forEach(x => { series[x.name] = x; });
  assert.equal(series['Série Alpha'].groupName, 'Séries US');
  assert.equal(series['Série Alpha'].seriesId, '501');
  assert.equal(series['Série Alpha'].rating, '8.1');
  assert.equal(series['Doc Deux'].groupName, 'Docs TV');
  assert.equal(await db.vod.count(), 4, 'DB-5 : aucune série dans vod');

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

test('XP-4 (repli par catégories) : catégorie live défaillante → ignorée, import complété', async () => {
  // failGlobal:true force le repli V9 — en mode global, les streams sont dans le
  // catalogue unique et il n'y a pas de « catégorie défaillante » au sens HTTP.
  const r = await runXtream({ failLiveCat: '20', failGlobal: true });
  assert.equal(await db.channels.where('importId').equals(r.importId).count(), 3, 'catégorie 20 ignorée');
  assert.equal(await db.vod.where('importId').equals(r.importId).count(), 4, 'vod intacte');
  assert.equal(await db.series.where('importId').equals(r.importId).count(), 5, 'séries via repli par catégories');
  assert.equal((await db.imports.get(r.importId)).status, 'completed');
  assert.equal(r.metaEvents.length, 0, 'repli : pas de totalItems → progression indéterminée');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('V10 mode global : category_id orphelin → groupe « Autres », sans appel par catégorie', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'Orp', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, {});
  const { setRoute } = await import('./helpers/fetchRouter.mjs');
  const api = BASE + '/player_api.php?username=' + encodeURIComponent(USER) + '&password=' + encodeURIComponent(PASS);
  const orphan = { stream_id: '999', name: 'Orphelin', epg_channel_id: null, stream_icon: '', category_id: '77' };
  setRoute(api + '&action=get_live_streams', [orphan]);
  const pair = makePair('xtream', 'channels');
  await pair.controller.startImport({ source: 'xtream', importId: importId, playlistId: plId,
                                     kind: 'playlist', base: BASE, username: USER, password: PASS });
  const o = await db.channels.get(String(importId) + ':999');
  assert.ok(o, 'stream orphelin importé');
  assert.equal(o.groupName, 'Autres', 'catégorie inconnue → « Autres » (Map locale)');
  assert.equal(await db.vod.where('importId').equals(importId).count(), 4, 'vod globale intacte');
  pair.controller.destroy(); pair.dataManager.destroy();
});

test('V11 séries (repli) : catégorie de séries 503 → ignorée, import complété', async () => {
  const r = await runXtream({ failGlobal: true, failSeriesCat: '31' });
  assert.equal(await db.series.where('importId').equals(r.importId).count(), 3, 'cat 31 ignorée, cat 30 importée');
  assert.equal((await db.imports.get(r.importId)).status, 'completed');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('V11 catégories serveur : ordre exact (live/vod/series) + purge complète à la réimportation', async () => {
  await freshDb();
  const plId = await addPlaylist(db, 'Cat', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');
  routeXtreamPanel(BASE, USER, PASS, {});
  const pair = makePair('xtream', 'channels');
  await pair.controller.startImport({ source: 'xtream', importId: importId, playlistId: plId,
                                     kind: 'playlist', base: BASE, username: USER, password: PASS });

  const byKind = async function (k) {
    const rows = await db.categories.where('[importId+kind]').equals([importId, k]).sortBy('sort');
    return rows.map(function (r) { return r.name; });
  };
  assert.deepEqual(await byKind('live'), ['Infos', 'Sports'], 'ordre du serveur, pas alphabétique');
  assert.deepEqual(await byKind('vod'), ['Cinéma']);
  assert.deepEqual(await byKind('series'), ['Séries US', 'Docs TV']);

  const importId2 = await addImportRow(db, plId, 'playlist');
  await pair.controller.startImport({ source: 'xtream', importId: importId2, playlistId: plId,
                                     kind: 'playlist', base: BASE, username: USER, password: PASS });
  assert.equal(await db.categories.where('importId').equals(importId).count(), 0, 'catégories de l’import périmé purgées');
  assert.equal(await db.categories.where('importId').equals(importId2).count(), 5);
  assert.equal(await db.series.where('importId').equals(importId).count(), 0, 'séries périmées purgées');
  assert.equal(await db.series.where('importId').equals(importId2).count(), 5);
  pair.controller.destroy(); pair.dataManager.destroy();
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
  assert.equal(
    XtreamClient.seriesInfoUrl('http://p', 'u', 'pw', '77'),
    'http://p/player_api.php?username=u&password=pw&action=get_series_info&series_id=77'
  );
  assert.equal(XtreamClient.seriesStreamUrl('http://p', 'u', 'pw', 9, 'mkv'), 'http://p/series/u/pw/9.mkv');
  assert.equal(XtreamClient.seriesStreamUrl('http://p', 'u', 'pw', 9), 'http://p/series/u/pw/9.mp4', 'extension défaut mp4');
});

test('bascule de table live→vod : jamais de CHUNK mixte (chaque lot porte UNE targetTable)', async () => {
  // 500+ streams live pour forcer plusieurs CHUNK ; le premier lot vod doit être
  // un CHUNK 'vod' séparé. On épie les messages worker→DataManager.
  await freshDb();
  const plId = await addPlaylist(db, 'XtT', { source: 'xtream', base: BASE, username: USER, password: PASS });
  const importId = await addImportRow(db, plId, 'playlist');

  // panneau modifié : catégorie live de CHUNK_ITEMS+1 streams (bord 2000/2001, V10)
  const bigLive = [];
  for (let i = 0; i < 2001; i++) bigLive.push({ stream_id: '1000' + i, name: 'L' + i, epg_channel_id: null, stream_icon: '' });
  routeXtreamPanel(BASE, USER, PASS, { failGlobal: true });
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
  assert.deepEqual(uniq.sort(), ['channels', 'series', 'vod'], 'trois tables vues, par lots séparés');
  assert.equal(await db.channels.where('importId').equals(importId).count(), 2003, '2001 (cat 10) + 2 (cat 20)');
  controller.destroy(); dm.destroy();
});
