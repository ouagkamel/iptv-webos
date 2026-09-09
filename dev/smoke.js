// dev/smoke.js — Sprint 0 (plan §4, DoD : « new Worker OK, Dexie ouvert, import
// 50 chaînes de fixture sans erreur, import interrompu → statut 'failed', pas
// d'orphelins au boot suivant »). Exécuté par dev/smoke.html sous `vite dev`
// (émulateur/TV) ou headless en CI locale. Syntaxe Chromium 68 stricte.
import { Capabilities } from '../src/utils/CapabilityDetector.js';
import { db } from '../src/data/db.js';
import { createImportPairs } from '../src/bootstrap.js';
import { PlaylistManager } from '../src/services/PlaylistManager.js';

function buildM3U(n) {
  var lines = ['#EXTM3U'];
  for (var i = 0; i < n; i++) {
    lines.push('#EXTINF:-1 tvg-id="smoke' + i + '" group-title="G' + (i % 4) + '",Smoke ' + (i + 1));
    lines.push('http://smoke.test/' + i + '.m3u8');
  }
  return lines.join('\n') + '\n';
}

function blobUrl(text) {
  return URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
}

function stage(name) {
  // Marqueur de progression lisible via CDP en cas de hang (outillage dev)
  if (typeof window !== 'undefined') window.__SMOKE_STAGE = name;
  var st = (typeof document !== 'undefined') && document.getElementById('status');
  if (st) st.textContent = 'RUNNING… ' + name;
}

export async function runSmoke() {
  var results = [];
  stage('boot');
  function record(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: String(detail == null ? '' : detail) });
  }
  var manager = null;
  var pairs = null;
  var plId = null;

  try {
    // 1. Détection capacités (baseline si pas de SDK — ne doit jamais jeter ici)
    var t0 = Date.now();
    var caps = await Capabilities.detectAll();
    record('Capabilities.detectAll', !!caps && Date.now() - t0 <= 1600,
      'webos ' + caps.webosVersion.major + '.' + caps.webosVersion.minor +
      ' · stream=' + caps.canStreamFetch + ' · MSE=' + caps.canUseMSE);

    // 2. Creation du vrai worker M3U (bundle Vite) + filet onerror
    stage('worker');
    var worker = new Worker(new URL('../src/data/m3u.worker.js', import.meta.url));
    var workerErr = await Promise.race([
      new Promise(function (res) { worker.addEventListener('error', function (e) { res('ERROR: ' + e.message); }); }),
      new Promise(function (res) { setTimeout(function () { res(null); }, 400); })
    ]);
    worker.terminate();
    record('new Worker(m3u) sans error event', workerErr === null, workerErr || 'alive 400ms');

    // 3. Ouverture Dexie à la version v2 (table vod présente = migration OK)
    stage('dexie.open');
    await db.open();
    record('Dexie ouvert en v2 (table vod)', db.verno >= 2, 'verno=' + db.verno);

    // 4. Import de bout en bout via la VRAIE chaîne (PlaylistManager → ImportController
    //    → DataManager → worker réel → IndexedDB réel), 50 chaînes
    stage('import50');
    pairs = createImportPairs();
    manager = new PlaylistManager(pairs);
    plId = await manager.create({ name: 'SMOKE', source: 'm3u', m3uUrl: blobUrl(buildM3U(50)) });
    var detail = await Promise.race([
      manager.importPlaylist(plId),
      new Promise(function (res, rej) { setTimeout(function () { rej(new Error('TIMEOUT 15s')); }, 15000); })
    ]);
    var pl = await db.playlists.get(plId);
    var count = await db.channels.where('importId').equals(detail.importId).count();
    var impRow = await db.imports.get(detail.importId);
    record('import 50 chaînes : count exact', count === 50, 'rows=' + count);
    record('swap actif + status completed',
      pl.activeImportId === detail.importId && impRow.status === 'completed',
      'active=' + pl.activeImportId);
    record('clé DB-1 déterministe (imp:0)', !!(await db.channels.get(detail.importId + ':0')));

    stage('boot-maintenance');
    // 5. Reprise sur crash (§5.5) : ligne 'running' orpheline → failed + purge partielles
    var stray = await db.imports.add({ playlistId: plId, kind: 'playlist', status: 'running', createdAt: Date.now() - 600000 });
    await db.channels.add({ id: stray + ':0', importId: stray, name: 'Orpheline', groupName: 'G0', channelId: null, logo: '', streamUrl: 'http://x', searchName: 'orpheline' });
    await manager.bootMaintenance();
    var strayRow = await db.imports.get(stray);
    record('§5.5 : running ancien → failed', !!strayRow && strayRow.status === 'failed');
    record('§5.5 : orpheline purgée', !(await db.channels.get(stray + ':0')));

  } catch (err) {
    record('exception non gérée', false, (err && err.message) || err);
  } finally {
    if (manager && plId != null) { try { await manager.remove(plId); } catch (e) { /* noop */ } }
    if (pairs) { try { pairs.destroyAll(); } catch (e2) { /* noop */ } }
  }

  var fail = 0;
  for (var i = 0; i < results.length; i++) if (!results[i].pass) fail++;
  results.summary = (fail === 0 ? 'SMOKE PASS ' : 'SMOKE FAIL ') + '(' + (results.length - fail) + '/' + results.length + ')';
  return results;
}
