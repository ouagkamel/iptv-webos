// tests/series-browser.test.mjs — V11 §6.6 : détail paresseux + cache TTL +
// normalisation des deux formes de panneaux + URL de lecture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db } from './helpers/dbx.mjs';
import { SeriesBrowser } from '../src/services/SeriesBrowser.js';

const XT_PL = { id: 1, source: 'xtream', base: 'http://p', username: 'u', password: 'p@ss/' };
const SERIES = { id: '7:501', importId: 7, seriesId: '501', name: 'Série Alpha' };

function jsonResponse(payload, ok, status) {
  return { ok: ok !== false, status: status || 200, json: async function () { return payload; } };
}

function seasonPanel() {
  return {
    info: { name: 'Série Alpha', rating: '8.1', plot: 'plot A' },
    seasons: {
      0: { name: 'Saison 1', episodes: {
        0: [{ id: '9002', episode_id: '2', title: 'Épisode 2', container_extension: 'mp4' }],
        1: [{ id: '9001', episode_id: '1', title: 'Épisode 1', container_extension: 'mkv' }]
      } },
      1: { name: 'Saison 2', episodes: {
        0: [{ id: '9003', episode_id: '1', title: 'Épisode 1 (S2)', container_extension: 'mkv' }]
      } }
    }
  };
}

test('SeriesBrowser : normalisation forme seasons (indices 0-based → n° 1-based, épisodes triés)', () => {
  const p = SeriesBrowser.normalize(seasonPanel());
  assert.equal(p.title, 'Série Alpha');
  assert.equal(p.seasons.length, 2);
  assert.equal(p.seasons[0].number, 1);
  assert.equal(p.seasons[0].episodes.length, 2);
  assert.deepEqual(p.seasons[0].episodes.map(function (e) { return e.episodeId; }), ['1', '2'], 'tri par n°');
  assert.equal(p.seasons[0].episodes[0].ext, 'mkv');
  assert.equal(p.seasons[1].number, 2);
});

test('SeriesBrowser : normalisation forme entries (aplatie → saison unique) + panneaux vides', () => {
  const p = SeriesBrowser.normalize({ info: { name: 'Doc' }, entries: {
    1: [{ id: '1', episode_id: '1', title: 'a' }]
  } });
  assert.equal(p.seasons.length, 1);
  assert.equal(p.seasons[0].name, 'Épisodes');
  assert.equal(p.seasons[0].episodes[0].ext, 'mp4', 'défaut d’extension');
  assert.deepEqual(SeriesBrowser.normalize(null).seasons, [], 'payload nul toléré');
  assert.deepEqual(SeriesBrowser.normalize({ seasons: { 0: { name: 'vide', episodes: {} } } }).seasons, [],
    'saison sans épisodes écartée');
});

test('SeriesBrowser : lazy + cache (1 fetch, 2 ouvertures), TTL expiré → refetch', async () => {
  await freshDb();
  let calls = 0;
  const seenUrls = [];
  const sb = new SeriesBrowser(function (url) {
    calls++; seenUrls.push(url);
    return Promise.resolve(jsonResponse(seasonPanel()));
  });
  const p1 = await sb.ensureInfo(XT_PL, SERIES);
  assert.equal(calls, 1);
  assert.ok(seenUrls[0].indexOf('action=get_series_info&series_id=501') !== -1, 'URL panneau exacte');
  assert.ok(seenUrls[0].indexOf('p%40ss%2F') !== -1, 'mot de passe encodé (XP-3)');
  assert.equal(p1.seasons.length, 2);
  const p2 = await sb.ensureInfo(XT_PL, SERIES);
  assert.equal(calls, 1, 'cache servi, zéro second fetch');
  assert.deepEqual(p2.seasons[0].episodes.map(function (e) { return e.id; }), ['9001', '9002']);
  const row = await db.series_info.get(SERIES.id);
  assert.equal(row.importId, 7);

  // TTL expiré (24 h + 1 s) → le panneau est rappelé
  await db.series_info.update(SERIES.id, { fetchedAt: Date.now() - 24 * 3600 * 1000 - 1000 });
  await sb.ensureInfo(XT_PL, SERIES);
  assert.equal(calls, 2, 'TTL expiré → refetch');
});

test('SeriesBrowser : erreurs HTTP/JSON non mises en cache, import jamais affecté', async () => {
  await freshDb();
  const sbHttp = new SeriesBrowser(function () { return Promise.resolve(jsonResponse(null, false, 404)); });
  await assert.rejects(sbHttp.ensureInfo(XT_PL, SERIES), /SERIES_INFO_HTTP_404/);
  assert.equal(await db.series_info.count(), 0);

  const sbBad = new SeriesBrowser(function () {
    return Promise.resolve({ ok: true, status: 200, json: async function () { throw new Error('json'); } });
  });
  await assert.rejects(sbBad.ensureInfo(XT_PL, SERIES), /SERIES_INFO_INVALID/);
  assert.equal(await db.series_info.count(), 0);

  const sbNet = new SeriesBrowser(function () { return Promise.reject(new Error('network down')); });
  await assert.rejects(sbNet.ensureInfo(XT_PL, SERIES), /SERIES_INFO_UNAVAILABLE/);
});

test('SeriesBrowser : playlist M3U → SERIES_XTREAM_ONLY (les séries sont Xtream-only)', async () => {
  await freshDb();
  const sb = new SeriesBrowser(function () { throw new Error('ne doit jamais FETCH'); });
  await assert.rejects(sb.ensureInfo({ id: 2, source: 'm3u' }, SERIES), /SERIES_XTREAM_ONLY/);
});

test('SeriesBrowser : URL de lecture d’épisode (extension du panneau respectée)', () => {
  assert.equal(
    SeriesBrowser.episodeUrl(XT_PL, { id: '9001', ext: 'mkv' }),
    'http://p/series/u/p%40ss%2F/9001.mkv'
  );
  assert.equal(SeriesBrowser.episodeUrl(XT_PL, { id: '9002', ext: 'mp4' }),
    'http://p/series/u/p%40ss%2F/9002.mp4');
});
