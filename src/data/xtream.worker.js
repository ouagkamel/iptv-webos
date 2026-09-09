// src/data/xtream.worker.js — spec §6.5 (amendement V9).
// Import natif Xtream Codes : le worker effectue lui-même ses fetch, de façon
// séquentielle et paginée par catégorie (mémoire bornée par la plus grosse
// catégorie). Protocole §5.2 (PROT-1…4) + ACCOUNT_INFO + ERROR (XP-1…XP-4).
//
// Écart assumé vs le pseudo-code de référence §6.5 : l'attente d'ack est une
// promesse résolue par CHUNK_COMMITTED au lieu d'un polling setInterval(16 ms)
// — comportement identique, sans timer résiduel (cohérent avec l'esprit
// anti-timer-zombie de la V8).
let isWaitingForAck = false;
let pendingItems = [];
let pendingTarget = 'channels';
let currentImportId = null;
let currentPlaylistId = null;
let aborted = false;
let cfg = null; // { base, username, password }
let ackWaiters = [];

self.onmessage = function (e) {
  const d = e.data;

  if (d.type === 'INIT_IMPORT') {
    currentImportId = d.importId;
    currentPlaylistId = d.playlistId;
    pendingItems = [];
    pendingTarget = 'channels';
    isWaitingForAck = false;
    aborted = false;
    cfg = { base: d.base, username: d.username, password: d.password };
    runImport();
    return;
  }
  if (d.type === 'CHUNK_COMMITTED') {
    if (d.importId !== currentImportId) return; // PROT-2
    isWaitingForAck = false;
    const waiters = ackWaiters.splice(0, ackWaiters.length);
    for (let i = 0; i < waiters.length; i++) waiters[i]();
    return;
  }
  if (d.type === 'ABORT_IMPORT') {
    aborted = true;
    currentImportId = null;
    pendingItems = [];
    isWaitingForAck = false;
    const waiters = ackWaiters.splice(0, ackWaiters.length);
    for (let i = 0; i < waiters.length; i++) waiters[i](); // libère le producteur suspendu
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

async function runImport() {
  try {
    // XP-1 : authentification AVANT toute écriture ; échec → ERROR terminal.
    const account = await fetchJson(apiUrl(null));
    const info = account && account.user_info;
    if (!info || String(info.status) !== 'Active') {
      throw new Error('XTREAM_AUTH_FAILED');
    }
    if (aborted || currentImportId === null) return;

    // Signal annexe : alimente DualPlayerPolicy.provider.maxConcurrentStreams (§7.5)
    self.postMessage({
      type: 'ACCOUNT_INFO',
      importId: currentImportId,
      maxConnections: parseInt(info.max_connections, 10) || 0,
      expDate: info.exp_date || null
    });

    // Live → channels ; VOD → vod (DB-5). Boucles séquentielles bornées (§6.5).
    await importCollection('get_live_categories', 'get_live_streams', 'channels', mapLiveItem);
    if (!aborted) await importCollection('get_vod_categories', 'get_vod_streams', 'vod', mapVodItem);

    if (aborted || currentImportId === null) return;
    await drainAll(); // PROT-4 : résiduels (< 500 et fin de table)

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
      pendingItems.push(mapFn(items[i], groupName));
      if (pendingItems.length >= 500) {
        await drainAll(); // PROT-1 : un seul CHUNK en vol — le producteur se suspend
      }
    }
  }
}

// Envoie tout `pendingItems` par lots de 500, un ack à la fois.
async function drainAll() {
  while (pendingItems.length > 0 && !aborted) {
    await waitForIdle();          // attend que le CHUNK en vol soit acquitté
    if (aborted || pendingItems.length === 0) return;
    isWaitingForAck = true;
    const items = pendingItems.splice(0, 500);
    self.postMessage({ type: 'CHUNK', importId: currentImportId, items: items, targetTable: pendingTarget });
  }
}

function waitForIdle() {
  if (!isWaitingForAck) return Promise.resolve();
  return new Promise(function (resolve) { ackWaiters.push(resolve); });
}

function mapLiveItem(s, groupName) {
  return {
    id: currentImportId0() + ':' + s.stream_id,
    importId: currentImportId0(),
    name: String(s.name || ''),
    channelId: s.epg_channel_id ? String(s.epg_channel_id) : null, // jointure EPG xmltv.php
    groupName: groupName,
    logo: s.stream_icon || '',
    streamUrl: cfg.base + '/live/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + s.stream_id + '.m3u8',
    searchName: normalizeSearchName(s.name)
  };
}

function mapVodItem(s, groupName) {
  const name = String(s.name || '');
  return {
    id: currentImportId0() + ':' + s.stream_id,
    importId: currentImportId0(),
    name: name,
    groupName: groupName,
    logo: s.stream_icon || '',
    streamUrl: cfg.base + '/movie/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + s.stream_id + '.' +
               (s.container_extension || 'mp4'),
    searchName: normalizeSearchName(s.name)
  };
}

function currentImportId0() { return currentImportId; }

function normalizeSearchName(name) {
  // Règle DB-3 (identique §5.1)
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
