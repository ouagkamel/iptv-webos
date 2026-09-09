// tests/harness-run.js — logique du harnais §9 partagée entre harness.html
// (TV/émulateur, sans top-level await — Chromium 68) ; en CI local,
  // exécuté dans chrome-headless-shell via tools/browser-run.mjs (voir tests/harness.html)
// (headless moderne, TLA pour capture CI). Syntaxe 68-safe de bout en bout :
// imports au sommet du module, tout le reste dans start().
import { db } from '../src/data/db.js';
import { createImportPairs } from '../src/bootstrap.js';
import { PlaylistManager } from '../src/services/PlaylistManager.js';
import { VirtualList } from '../src/ui/VirtualList.js';
import { DualPlayerPolicy } from '../src/media/DualPlayerPolicy.js';

export function start() {
  var out = document.getElementById('out');
  var status = document.getElementById('status');
  var rows = [];

  function record(name, pass, detail) {
    rows.push({ name: name, pass: !!pass, detail: String(detail == null ? '' : detail) });
    var d = document.createElement('div');
    d.className = pass ? 'ok' : 'ko';
    d.textContent = (pass ? '[OK] ' : '[KO] ') + name + (detail ? ' — ' + detail : '');
    out.appendChild(d);
  }
  function blobUrl(text) { return URL.createObjectURL(new Blob([text], { type: 'text/plain' })); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }

  function buildM3U(n, opts) {
    opts = opts || {};
    var lines = ['#EXTM3U'];
    for (var i = 0; i < n; i++) {
      lines.push('#EXTINF:-1 tvg-id="ch' + i + '" group-title="G' + (i % 4) + '",' + (opts.prefix || 'Ch') + ' ' + (i + 1));
      lines.push('http://h.test/' + i + '.m3u8');
    }
    if (opts.trailing) lines.push('#EXTINF:-1,orpheline sans URL');
    return lines.join('\n') + '\n';
  }
  function pad(x, l) { x = String(x); while (x.length < (l || 2)) x = '0' + x; return x; }
  function fmtU(d) {
    return '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
  }
  function buildXmltv(n) {
    var base = Date.UTC(2026, 0, 1, 12, 0, 0);
    var parts = ['<?xml version="1.0"?><tv>'];
    for (var i = 0; i < n; i++) {
      var s = fmtU(new Date(base + i * 1800000)), e = fmtU(new Date(base + (i + 1) * 1800000));
      parts.push('<programme channel="ch' + (i % 10) + '" start="' + s + '" stop="' + e + '"><title>T' + (i + 1) + '</title></programme>');
    }
    parts.push('</tv>');
    return parts.join('');
  }

  var pairs = createImportPairs();
  var manager = new PlaylistManager(pairs);
  var imported = [];

  async function newPlaylist(url) {
    await manager.create({ name: 'HARNESS', source: 'm3u', m3uUrl: url, epgUrl: url });
    var list = await manager.list();
    var pl = list[list.length - 1].id;
    imported.push(pl);
    return pl;
  }
  async function importVia(url, kind) {
    var pl = await newPlaylist(url);
    if (kind === 'epg') {
      var importId = await db.imports.add({ playlistId: pl, kind: 'epg', status: 'running', createdAt: Date.now() });
      var pair = pairs.get('epg');
      var detail = await pair.controller.startImport({ importId: importId, playlistId: pl, kind: 'epg', url: url });
      return { detail: detail, importId: importId, pl: pl };
    }
    var detail2 = await manager.importPlaylist(pl);
    return { detail: detail2, importId: detail2.importId, pl: pl };
  }
  async function cleanup() {
    for (var i = 0; i < imported.length; i++) { try { await manager.remove(imported[i]); } catch (e) { /* noop */ } }
    imported = [];
  }

  async function runAll() {
    await db.open();

    // H1 — PROT-4 : résidu < 500 en fin de flux doit drainer (1 237 + EXTINF orphelin)
    try {
      var r = await Promise.race([importVia(blobUrl(buildM3U(1237, { trailing: true })), 'playlist'),
                                  sleep(25000).then(function () { return 'TIMEOUT'; })]);
      if (r === 'TIMEOUT') record('H1 m3u-1237 (résidu PROT-4)', false, 'délai dépassé');
      else record('H1 m3u-1237 (résidu PROT-4)', (await db.channels.where('importId').equals(r.importId).count()) === 1237,
                  'rows=' + (await db.channels.where('importId').equals(r.importId).count()));
    } catch (e) { record('H1', false, e.message); }
    await cleanup();

    // H2 — xmltv-644 : terminaison + statut completed
    try {
      var r2 = await Promise.race([importVia(blobUrl(buildXmltv(644)), 'epg'),
                                   sleep(25000).then(function () { return 'TIMEOUT'; })]);
      if (r2 === 'TIMEOUT') record('H2 xmltv-644', false, 'délai dépassé');
      else {
        var c2 = await db.epg.where('importId').equals(r2.importId).count();
        var st = (await db.imports.get(r2.importId)).status;
        record('H2 xmltv-644', c2 === 644 && st === 'completed', 'rows=' + c2 + ' status=' + st);
      }
    } catch (e) { record('H2', false, e.message); }
    await cleanup();

    // H3 — xmltv-500-exact : bord de modulo
    try {
      var r3 = await importVia(blobUrl(buildXmltv(500)), 'epg');
      record('H3 xmltv-500-exact', (await db.epg.where('importId').equals(r3.importId).count()) === 500);
    } catch (e) { record('H3', false, e.message); }
    await cleanup();

    // H4 — offsets +0100/−0500 + dates 12 chiffres
    try {
      var xml = '<?xml version="1.0"?><tv>' +
        '<programme channel="cA" start="20260101180000 +0100" stop="20260101190000 +0100"><title>A</title></programme>' +
        '<programme channel="cB" start="20260101180000 -0500" stop="20260101190000"><title>B</title></programme>' +
        '<programme channel="cC" start="202601011800" stop="202601011900"><title>C</title></programme></tv>';
      var r4 = await importVia(blobUrl(xml), 'epg');
      var rows4 = await db.epg.where('importId').equals(r4.importId).toArray();
      var byCh = {}; for (var q = 0; q < rows4.length; q++) byCh[rows4[q].channelId] = rows4[q];
      var ok4 = byCh.cA && byCh.cA.startTime === Date.UTC(2026, 0, 1, 17, 0, 0) &&
                byCh.cB && byCh.cB.startTime === Date.UTC(2026, 0, 1, 23, 0, 0) &&
                byCh.cC && byCh.cC.startTime === Date.UTC(2026, 0, 1, 18, 0, 0);
      record('H4 offsets +0100/−0500 + dates-12', !!ok4);
    } catch (e) { record('H4', false, e.message); }
    await cleanup();

    // H5 — PROT-6 : second import en vol → rejet BUSY
    try {
      var pl5 = await newPlaylist(blobUrl(buildM3U(20000)));
      var p1 = manager.importPlaylist(pl5);
      await sleep(150);
      var busy = false;
      try { await manager.importPlaylist(pl5); } catch (e) { busy = /BUSY/.test(e.message); }
      pairs.get('playlist').controller.abort(); // libère le harness sans finir 20k
      try { await p1; } catch (e2) { /* attendu */ }
      record('H5 PROT-6 second rejeté (BUSY)', busy);
    } catch (e) { record('H5', false, e.message); }
    await cleanup();

    // H6 — abort en vol : rejet + failed + purge partielles + worker réutilisable
    try {
      var pl6 = await newPlaylist(blobUrl(buildM3U(20000)));
      var p6 = manager.importPlaylist(pl6);
      await sleep(250); // laisser l'async du service atteindre startImport
      var importId6 = pairs.get('playlist').controller.currentImportId;
      manager.abort(pl6, 'playlist');
      var rejected = false;
      try { await p6; } catch (e3) { rejected = /IMPORT_ABORTED/.test(e3.message); }
      var row6 = importId6 != null ? await db.imports.get(importId6) : null;
      await sleep(400);
      var partRows = importId6 != null ? await db.channels.where('importId').equals(importId6).count() : -1;
      record('H6 abort : rejet+failed+purge', rejected && !!row6 && row6.status === 'failed' && partRows === 0,
             'rejet=' + rejected + ' status=' + (row6 && row6.status) + ' partielles=' + partRows);
      var pl7 = await newPlaylist(blobUrl(buildM3U(10)));
      var r7 = await manager.importPlaylist(pl7);
      record('H6b worker réutilisable après abort',
             (await db.channels.where('importId').equals(r7.importId).count()) === 10);
    } catch (e) { record('H6', false, e.message); }
    await cleanup();

    // H7 — invariant §1.2-6 : nœuds rendus bornés sur 20 000 items (DOM réel)
    try {
      var host = document.getElementById('list-host');
      var scroller = document.createElement('div');
      scroller.style.height = '600px'; scroller.style.overflow = 'auto';
      host.appendChild(scroller);
      var list = new VirtualList(scroller, { itemHeight: 60, overscan: 4 });
      list.mount();
      var items = []; for (var v = 0; v < 20000; v++) items.push({ name: 'V' + v });
      list.setItems(items);
      await nextFrame(); await nextFrame();
      var cap = list._maxNodes();
      var worst = 0;
      var positions = [0, 300000, 20000 * 60 - 600];
      for (var pp = 0; pp < positions.length; pp++) {
        scroller.scrollTop = positions[pp];
        list._onScroll(); await nextFrame(); await nextFrame();
        if (list.getRenderedNodeCount() > worst) worst = list.getRenderedNodeCount();
      }
      record('H7 VirtualList 20k : nœuds ≤ ' + cap, worst <= cap, 'worst=' + worst);
      list.destroy(); host.removeChild(scroller);
    } catch (e) { record('H7', false, e.message); }

    // H8 — politique Dual Player
    record('H8 DualPlayerPolicy triple porte',
      DualPlayerPolicy.isEligible({ isWebOS6OrHigher: true, modelName: 'QNED99X' }, { maxConcurrentStreams: 2 }) === true &&
      DualPlayerPolicy.isEligible({ isWebOS6OrHigher: false, modelName: 'QNED99X' }, { maxConcurrentStreams: 9 }) === false &&
      DualPlayerPolicy.shouldActivate(800) === true);

    // H9 — bouton (lourd, manuel sur device) : 20 000 + échantillonnage rAF (mini-T3)
    var heavyBtn = document.getElementById('heavy');
    if (heavyBtn && heavyBtn.addEventListener) {
      heavyBtn.addEventListener('click', async function () {
        record('H9 import 20k + métrique trames…', true, 'en cours');
        var worstF = 0, last = performance.now(), sampling = true;
        (function tick() {
          if (!sampling) return;
          var now = performance.now();
          if (now - last > worstF) worstF = now - last;
          last = now;
          requestAnimationFrame(tick);
        })();
        var t0 = Date.now();
        try {
          var pl9 = await newPlaylist(blobUrl(buildM3U(20000)));
          var r9 = await manager.importPlaylist(pl9);
          var c9 = await db.channels.where('importId').equals(r9.importId).count();
          var secs = (Date.now() - t0) / 1000;
          record('H9 import 20k : ' + c9 + ' lignes en ' + secs.toFixed(1) + 's', c9 === 20000,
                 'pire intervalle rAF=' + worstF.toFixed(0) + ' ms (rapport T3 : noter si > 50 ms)');
        } catch (e9) { record('H9', false, e9.message); }
        sampling = false;
        await cleanup();
        status.textContent = finish();
        publish();
      });
    }

    status.textContent = finish();
    publish();
  }

  function finish() {
    var fail = 0;
    for (var i = 0; i < rows.length; i++) if (!rows[i].pass) fail++;
    return (fail === 0 ? 'HARNESS PASS ' : 'HARNESS FAIL ') + '(' + (rows.length - fail) + '/' + rows.length + ')';
  }
  function publish() {
    window.__HARNESS = { rows: rows, summary: status.textContent, done: true };
    document.title = status.textContent;
  }

  async function runSmokeGuard() {
    try { await runAll(); }
    catch (e) { record('RUNNER', false, e.message); status.textContent = finish(); publish(); }
  }

  return runSmokeGuard().then(function () { return status.textContent; });
}
