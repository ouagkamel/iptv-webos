// src/data/xtream.worker.js — spec §6.5 (amendement V9).
// Import natif Xtream Codes : le worker effectue lui-même ses fetch, utilise le
// catalogue global puis le repli paginé par catégorie. V18 : lots TV de 2 000,
// deux CHUNK en vol, objets compacts et ACK identifiés par chunkId. Protocole
// §5.2 (PROT-1…7) + ACCOUNT_INFO + ERROR (XP-1…XP-4).
//
// Le worker peut maintenant préparer deux lots pendant que DataManager écrit le
// précédent. Les ACK portent un chunkId : un ACK tardif ou dupliqué ne libère
// jamais le mauvais lot.
const MAX_CHUNKS_IN_FLIGHT = 2;
let inFlightChunkIds = new Set();
let nextChunkId = 0;
let slotWaiters = [];
let idleWaiters = [];
let pendingItems = [];
let pendingTarget = 'channels';
let currentImportId = null;
let currentPlaylistId = null;
let aborted = false;
let cfg = null; // { base, username, password }
// V13 §5.3 : position d'arrivée par table (ordre serveur), lue au tri d'affichage.
let sortCounter = Object.create(null);
function nextSortIdx(targetTable) {
  const n = sortCounter[targetTable] || 0;
  sortCounter[targetTable] = n + 1;
  return n;
}

self.onmessage = function (e) {
  const d = e.data;

  if (d.type === 'INIT_IMPORT') {
    currentImportId = d.importId;
    currentPlaylistId = d.playlistId;
    pendingItems = [];
    pendingTarget = 'channels';
    inFlightChunkIds = new Set();
    nextChunkId = 0;
    slotWaiters = [];
    idleWaiters = [];
    aborted = false;
    sortCounter = Object.create(null);
    applyProfile(d.profile);
    cfg = { base: d.base, username: d.username, password: d.password };
    runImport();
    return;
  }
  if (d.type === 'CHUNK_COMMITTED') {
    if (d.importId !== currentImportId) return; // ACK d'un import mort
    if (!inFlightChunkIds.has(d.chunkId)) return; // ACK tardif ou dupliqué
    inFlightChunkIds.delete(d.chunkId);
    releaseSlotWaiters();
    if (inFlightChunkIds.size === 0) releaseIdleWaiters();
    return;
  }
  if (d.type === 'ABORT_IMPORT') {
    aborted = true;
    currentImportId = null;
    pendingItems = [];
    inFlightChunkIds.clear();
    releaseSlotWaiters();
    releaseIdleWaiters();
  }
};

function apiUrl(action, categoryId) {
  let u = cfg.base + '/player_api.php?username=' + encodeURIComponent(cfg.username) +
          '&password=' + encodeURIComponent(cfg.password);
  if (action) u += '&action=' + action;
  if (categoryId != null) u += '&category_id=' + encodeURIComponent(categoryId);
  return u;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('XTREAM_HTTP_' + res.status);
  const json = await res.json();
  return json;
}

// V10 — mode catalogue global (§6.5) : un seul appel sans category_id ; la
// mémoire est bornée par le catalogue (Content-Length > MAX_GLOBAL_BYTES → repli).
// Le repli par catégories (boucle V9, bornée par la plus grosse catégorie)
// conserve XP-4 : catégorie défaillante ignorée, jamais terminal.
const DEFAULT_CHUNK_ITEMS = 2000;
const MIN_CHUNK_ITEMS = 1000;
const MAX_CHUNK_ITEMS = 2500;
const DEFAULT_YIELD_EVERY_CHUNKS = 4;
const MAX_GLOBAL_BYTES = 40 * 1024 * 1024;
let chunkItems = DEFAULT_CHUNK_ITEMS;
let yieldEveryChunks = DEFAULT_YIELD_EVERY_CHUNKS;
let parallelCatalogs = true;

function applyProfile(profile) {
  const p = profile || {};
  const n = parseInt(p.chunkItems, 10);
  chunkItems = n >= MIN_CHUNK_ITEMS && n <= MAX_CHUNK_ITEMS ? n : DEFAULT_CHUNK_ITEMS;
  const every = parseInt(p.yieldEveryChunks, 10);
  yieldEveryChunks = every > 0 && every <= 16 ? every : DEFAULT_YIELD_EVERY_CHUNKS;
  parallelCatalogs = p.parallelCatalogs !== false;
}

async function fetchGlobalArray(action) {
  let res;
  try {
    res = await fetch(apiUrl(action));
  } catch (eNet) {
    return null; // repli silencieux
  }
  if (!res.ok) return null;
  const cl = parseInt((res.headers && res.headers.get('Content-Length')) || '0', 10) || 0;
  if (cl > MAX_GLOBAL_BYTES) {
    try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e1) { /* noop */ }
    return null;
  }
  try {
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch (e2) {
    return null;
  }
}

function emitPhase(phase, label) {
  if (currentImportId === null || aborted) return;
  self.postMessage({ type: 'IMPORT_PHASE', importId: currentImportId,
                     playlistId: currentPlaylistId, phase: phase, label: label });
}

async function runImport() {
  try {
    // Phase visible dès le clic : Xtream ne peut connaître totalItems qu'après
    // les catalogues JSON ; le badge ne reste plus silencieux pendant ce temps.
    emitPhase('auth', 'Connexion au serveur…');
    // XP-1 : authentification AVANT toute écriture ; échec → ERROR terminal.
    const account = await fetchJson(apiUrl(null));
    const info = account && account.user_info;
    if (!info || String(info.status) !== 'Active') {
      throw new Error('XTREAM_AUTH_FAILED');
    }
    if (aborted || currentImportId === null) return;

    emitPhase('categories', 'Lecture des catégories serveur…');
    // Signal annexe : alimente DualPlayerPolicy.provider.maxConcurrentStreams (§7.5)
    self.postMessage({
      type: 'ACCOUNT_INFO',
      importId: currentImportId,
      maxConnections: parseInt(info.max_connections, 10) || 0,
      expDate: info.exp_date || null
    });

    // Live → channels ; VOD → vod (DB-5) ; Séries → series (DB-6, §6.6). Mode
    // global d'abord, repli par catégories si l'appel global est indisponible (V10).
    const catNames = { channels: {}, vod: {}, series: {} };
    const rawCats = {};
    await Promise.all([
      fetchJson(apiUrl('get_live_categories')).then(function (c) { fillCatNames(catNames.channels, c); rawCats.live = c; })
        .catch(function () { if (aborted) return; catNames.channels = {}; }),
      fetchJson(apiUrl('get_vod_categories')).then(function (c) { fillCatNames(catNames.vod, c); rawCats.vod = c; })
        .catch(function () { if (aborted) return; catNames.vod = {}; }),
      fetchJson(apiUrl('get_series_categories')).then(function (c) { fillCatNames(catNames.series, c); rawCats.series = c; })
        .catch(function () { if (aborted) return; catNames.series = {}; })
    ]);
    if (aborted || currentImportId === null) return;
    // Catégories serveur (V11) : ordre exact du panneau, émis AVANT les items.
    // Message annexe additif — le DataManager écrit db.categories, jamais via CHUNK.
    emitCategories('live', rawCats.live);
    emitCategories('vod', rawCats.vod);
    emitCategories('series', rawCats.series);

    emitPhase('catalogue', 'Téléchargement des catalogues…');
    // Les trois catalogues sont indépendants : les récupérer en parallèle
    // supprime deux RTT séquentiels avant le premier pourcentage, sans changer
    // l'ordre d'écriture (live → vod → séries) ni la mémoire maximale des JSON.
    let globals;
    if (parallelCatalogs) {
      globals = await Promise.all([
        fetchGlobalArray('get_live_streams'),
        fetchGlobalArray('get_vod_streams'),
        fetchGlobalArray('get_series')
      ]);
    } else {
      globals = [await fetchGlobalArray('get_live_streams'),
                 await fetchGlobalArray('get_vod_streams'),
                 await fetchGlobalArray('get_series')];
    }
    let liveGlobal = globals[0];
    let vodGlobal = globals[1];
    let seriesGlobal = globals[2];
    if (aborted || currentImportId === null) return;

    if (liveGlobal !== null && vodGlobal !== null) {
      // Métadonnée de progression : total connu → badge en pourcentage de lignes.
      self.postMessage({ type: 'IMPORT_META', importId: currentImportId,
                         playlistId: currentPlaylistId,
                         totalItems: liveGlobal.length + vodGlobal.length +
                                     (seriesGlobal !== null ? seriesGlobal.length : 0) });
      emitPhase('write-live', 'Écriture des chaînes…');
      await importItemsFlat(liveGlobal, 'channels', function (it, idx) { return mapLiveItem(it, catNames.channels[String(it.category_id)] || 'Autres', idx); });
      if (aborted || currentImportId === null) return;
      emitPhase('write-vod', 'Écriture des films…');
      await importItemsFlat(vodGlobal, 'vod', function (it, idx) { return mapVodItem(it, catNames.vod[String(it.category_id)] || 'Autres', idx); });
      liveGlobal = null; vodGlobal = null; // libère le JSON dès la mise en file
      // (les séries sont drainées par la section commune, qui connaît seriesGlobal)
    } else {
      // Repli V9 : paginé par catégorie (progression = indéterminée, pas de meta).
      if (liveGlobal !== null) {
        emitPhase('write-live', 'Écriture des chaînes…');
        await importItemsFlat(liveGlobal, 'channels', function (it, idx) { return mapLiveItem(it, catNames.channels[String(it.category_id)] || 'Autres', idx); });
      } else {
        emitPhase('write-live', 'Écriture des chaînes par catégorie…');
        await importCollection('get_live_categories', 'get_live_streams', 'channels', mapLiveItem);
      }
      if (!aborted && currentImportId !== null) {
        if (vodGlobal !== null) {
          emitPhase('write-vod', 'Écriture des films…');
          await importItemsFlat(vodGlobal, 'vod', function (it, idx) { return mapVodItem(it, catNames.vod[String(it.category_id)] || 'Autres', idx); });
        } else {
          emitPhase('write-vod', 'Écriture des films par catégorie…');
          await importCollection('get_vod_categories', 'get_vod_streams', 'vod', mapVodItem);
        }
      }
    }
    // Séries : chemin propre (global si dispo, sinon repli par catégories, §6.6).
    if (!aborted && currentImportId !== null) {
      if (seriesGlobal !== null) {
        emitPhase('write-series', 'Écriture des séries…');
        await importItemsFlat(seriesGlobal, 'series', function (it, idx) { return mapSeriesItem(it, catNames.series[String(it.category_id)] || 'Autres', idx); });
      } else {
        emitPhase('write-series', 'Écriture des séries par catégorie…');
        await importCollection('get_series_categories', 'get_series', 'series', mapSeriesItem);
      }
      seriesGlobal = null;
    }

    if (aborted || currentImportId === null) return;
    await drainAll(); // PROT-4 : résiduels (< CHUNK_ITEMS et fin de table)

    if (aborted || currentImportId === null || pendingItems.length > 0) return;
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    currentImportId = null; // protocole terminé : jamais de double COMPLETE
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'playlist' });
  } catch (err) {
    if (currentImportId !== null) {
      const importId = currentImportId;
      currentImportId = null;
      self.postMessage({ type: 'ERROR', importId: importId,
                         message: String((err && err.message) || err) });
    }
  }
}

function emitCategories(kind, cats) {
  if (currentImportId === null || aborted) return;
  if (!Array.isArray(cats)) return;
  const out = [];
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    if (c && c.category_id != null) out.push({ name: String(c.category_name || 'Autres') });
  }
  if (out.length > 0) {
    self.postMessage({ type: 'CATEGORIES', importId: currentImportId,
                       playlistId: currentPlaylistId, kind: kind, categories: out });
  }
}

function fillCatNames(dest, cats) {
  if (!Array.isArray(cats)) return;
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    if (c && c.category_id != null) dest[String(c.category_id)] = String(c.category_name || 'Autres');
  }
}

// Drain local d'un tableau déjà en mémoire : MÊME protocole PROT-1 que la boucle
// par catégories — le producteur se suspend à chaque lot plein (await drainAll).
async function importItemsFlat(items, targetTable, mapFn) {
  // Un CHUNK ne porte qu'UNE table cible : bascule de table = drain complet
  // (même garde que la boucle par catégories V9).
  if (pendingItems.length > 0 && pendingTarget !== targetTable) {
    await drainAll();
  }
  pendingTarget = targetTable;
  for (let i = 0; i < items.length; i++) {
    if (aborted) return;
    pendingItems.push(mapFn(items[i], nextSortIdx(targetTable)));
    if (pendingItems.length >= chunkItems) {
      await drainAvailable();
    }
  }
}

async function importCollection(catAction, listAction, targetTable, mapFn) {
  const cats = await fetchJson(apiUrl(catAction));
  if (aborted || !Array.isArray(cats)) return;

  for (let c = 0; c < cats.length; c++) {
    if (aborted) return;
    const catId = cats[c] && cats[c].category_id;
    const groupName = String((cats[c] && cats[c].category_name) || 'Autres');

    let items = [];
    try {
      items = await fetchJson(apiUrl(listAction, catId));
    } catch (eCat) {
      // XP-4 : catégorie défaillante ignorée (WARNING documenté) — jamais terminal
      continue;
    }
    if (aborted || !Array.isArray(items)) continue;

    for (let i = 0; i < items.length; i++) {
      if (aborted) return;
      // Un CHUNK ne porte qu'UNE table cible : bascule de table = drain complet.
      if (pendingItems.length > 0 && pendingTarget !== targetTable) {
        await drainAll();
      }
      pendingTarget = targetTable;
      pendingItems.push(mapFn(items[i], groupName, nextSortIdx(targetTable)));
      if (pendingItems.length >= chunkItems) {
        await drainAvailable(); // au plus deux CHUNK en vol
      }
    }
  }
}

// Envoie les lots pleins disponibles sans attendre la fin des écritures. Si les
// deux emplacements sont occupés, l'appel attend seulement qu'un slot se libère,
// puis le mapping reprend : CPU Worker et IndexedDB travaillent en parallèle.
async function drainAvailable() {
  while (pendingItems.length >= chunkItems && !aborted) {
    await waitForSlot();
    if (aborted || pendingItems.length < chunkItems) return;
    sendChunk(pendingItems.splice(0, chunkItems));
  }
}

// En fin de table/import, envoie aussi le résiduel puis attend les deux ACK.
async function drainAll() {
  while (pendingItems.length > 0 && !aborted) {
    await waitForSlot();
    if (aborted || pendingItems.length === 0) break;
    sendChunk(pendingItems.splice(0, chunkItems));
  }
  if (!aborted) await waitForIdle();
}

function sendChunk(items) {
  const chunkId = nextChunkId++;
  inFlightChunkIds.add(chunkId);
  self.postMessage({
    type: 'CHUNK',
    importId: currentImportId,
    chunkId: chunkId,
    items: items,
    targetTable: pendingTarget,
    yieldEveryChunks: yieldEveryChunks
  });
}

function waitForSlot() {
  if (aborted || inFlightChunkIds.size < MAX_CHUNKS_IN_FLIGHT) return Promise.resolve();
  return new Promise(function (resolve) { slotWaiters.push(resolve); });
}

function waitForIdle() {
  if (aborted || inFlightChunkIds.size === 0) return Promise.resolve();
  return new Promise(function (resolve) { idleWaiters.push(resolve); });
}

function releaseSlotWaiters() {
  while (slotWaiters.length > 0 && inFlightChunkIds.size < MAX_CHUNKS_IN_FLIGHT) {
    slotWaiters.shift()();
  }
}

function releaseIdleWaiters() {
  const waiters = idleWaiters.splice(0, idleWaiters.length);
  for (let i = 0; i < waiters.length; i++) waiters[i]();
}

// Les panneaux renvoient souvent beaucoup de métadonnées inutiles. Ces trois
// mappeurs fabriquent des objets plats et bornés : aucune propriété du JSON
// Xtream original ne traverse postMessage par accident.
function compactText(value) {
  return value == null ? '' : String(value);
}

function mapLiveItem(s, groupName, sortIdx) {
  const streamId = compactText(s.stream_id);
  const name = compactText(s.name);
  const importId = currentImportId0();
  return {
    sortIdx: sortIdx | 0,
    id: importId + ':' + streamId,
    importId: importId,
    name: name,
    channelId: s.epg_channel_id ? compactText(s.epg_channel_id) : null,
    groupName: compactText(groupName),
    logo: compactText(s.stream_icon),
    streamUrl: cfg.base + '/live/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + encodeURIComponent(streamId) + '.m3u8',
    searchName: normalizeSearchName(name)
  };
}

function mapVodItem(s, groupName, sortIdx) {
  const streamId = compactText(s.stream_id);
  const name = compactText(s.name);
  const importId = currentImportId0();
  return {
    sortIdx: sortIdx | 0,
    id: importId + ':' + streamId,
    importId: importId,
    name: name,
    groupName: compactText(groupName),
    logo: compactText(s.stream_icon),
    streamUrl: cfg.base + '/movie/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + encodeURIComponent(streamId) + '.' +
               compactText(s.container_extension || 'mp4'),
    searchName: normalizeSearchName(name)
  };
}

function mapSeriesItem(s, groupName, sortIdx) {
  const seriesId = compactText(s.series_id);
  const name = compactText(s.name);
  const importId = currentImportId0();
  return {
    sortIdx: sortIdx | 0,
    id: importId + ':' + seriesId,
    importId: importId,
    seriesId: seriesId,
    name: name,
    groupName: compactText(groupName),
    logo: compactText(s.cover || s.stream_icon),
    plot: compactText(s.plot),
    rating: s.rating == null ? '' : compactText(s.rating),
    releaseDate: compactText(s.releaseDate || s.release_date),
    searchName: normalizeSearchName(name)
  };
}

function currentImportId0() { return currentImportId; }

function normalizeSearchName(name) {
  // Règle DB-3 (identique §5.1)
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
