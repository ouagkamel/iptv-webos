// src/data/m3u.worker.js — tokenisation M3U (#EXTINF/#EXTGRP),
// id = importId + ':' + seq (DB-1), searchName normalisé (DB-3).
//
// V18 : deux CHUNK IndexedDB en vol. Le parseur peut donc continuer à produire
// pendant que DataManager écrit le lot précédent ; le watermark réseau reste
// indépendant et est piloté par ImportController.
const CHUNK_ITEMS = 2000;
const MAX_CHUNKS_IN_FLIGHT = 2;

// V11 (§6.4) : catégories M3U = group-title du fichier, dans l'ordre de première
// apparition (« définies par le serveur » = par la playlist elle-même).
let groupOrder = [];
let groupSeen = Object.create(null);

let lineCarry = '';
let pendingName = null;
let pendingGroup = null;
let pendingChannelId = null;
let pendingLogo = null;
let seq = 0;

let pendingItems = [];
let inFlightChunkIds = new Set();
let nextChunkId = 0;
let currentImportId = null;
let currentPlaylistId = null;
let isStreamEnded = false;

self.onmessage = function (e) {
  const data = e.data;
  const type = data.type;

  if (type === 'INIT_IMPORT') {
    currentImportId = data.importId;
    currentPlaylistId = data.playlistId;
    lineCarry = '';
    groupOrder = [];
    groupSeen = Object.create(null);
    pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
    seq = 0;
    pendingItems = [];
    inFlightChunkIds = new Set();
    nextChunkId = 0;
    isStreamEnded = false;
    return;
  }

  if (type === 'CHUNK_COMMITTED') {
    if (data.importId !== currentImportId) return;
    if (!inFlightChunkIds.has(data.chunkId)) return;
    inFlightChunkIds.delete(data.chunkId);
    flushPendingItems(isStreamEnded);
    checkCompletion();
    return;
  }

  if (type === 'PARSE_CHUNK') {
    if (data.importId !== currentImportId) return;
    parseChunk(data.xmlChunk, false);
    self.postMessage({ type: 'CHUNK_PARSED', importId: currentImportId });
    return;
  }

  if (type === 'END_OF_STREAM') {
    if (data.importId !== currentImportId) return;
    isStreamEnded = true;
    parseChunk('', true);      // solde la dernière ligne ; EXTINF sans URL écarté
    flushPendingItems(true);   // envoie jusqu'à deux lots puis les suivants sur ACK
    checkCompletion();
    return;
  }

  if (type === 'ABORT_IMPORT') {
    if (data.importId !== null && data.importId !== currentImportId) return;
    currentImportId = null;
    pendingItems = [];
    lineCarry = '';
    pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
    inFlightChunkIds.clear();
    isStreamEnded = false;
  }
};

function parseChunk(chunk, isFinal) {
  const text = lineCarry + chunk;
  const lines = text.split('\n');
  // La dernière découpe n'est peut-être pas finie : on la garde pour le prochain chunk.
  lineCarry = lines.pop();
  if (isFinal && lineCarry.length > 0) {
    const last = lineCarry;
    lineCarry = '';
    handleLine(last);
  }
  for (let i = 0; i < lines.length; i++) {
    handleLine(lines[i]);
    if (pendingItems.length >= CHUNK_ITEMS) flushPendingItems(false);
  }
}

function attr(str, name) {
  const m = new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i').exec(str || '');
  return m ? m[1] : null;
}

function handleLine(rawLine) {
  const line = rawLine.replace(/\r$/, '').trim();
  if (line.length === 0) return;

  if (line.indexOf('#EXTINF') === 0) {
    const comma = line.indexOf(',');
    const attrsPart = comma !== -1 ? line.substring(0, comma) : line;
    const displayName = comma !== -1 ? line.substring(comma + 1).trim() : '';
    pendingName = displayName || null;
    pendingChannelId = attr(attrsPart, 'tvg-id');
    pendingLogo = attr(attrsPart, 'tvg-logo');
    const g = attr(attrsPart, 'group-title');
    pendingGroup = g !== null ? g : null;
    return;
  }

  if (line.indexOf('#EXTGRP') === 0) {
    pendingGroup = line.substring(7).replace(/^:/, '').trim() || pendingGroup;
    return;
  }

  if (line.charAt(0) === '#') return;

  const name = pendingName !== null ? pendingName : line.substring(line.lastIndexOf('/') + 1);
  const grp = pendingGroup || 'Autres';
  if (!groupSeen[grp]) { groupSeen[grp] = true; groupOrder.push(grp); }
  pendingItems.push({
    sortIdx: seq,
    id: currentImportId + ':' + seq,
    importId: currentImportId,
    name: name,
    channelId: pendingChannelId,
    groupName: grp,
    logo: pendingLogo || '',
    streamUrl: line,
    searchName: normalizeSearchName(name)
  });
  seq += 1;
  pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
}

function normalizeSearchName(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function flushPendingItems(force) {
  while (inFlightChunkIds.size < MAX_CHUNKS_IN_FLIGHT &&
         (pendingItems.length >= CHUNK_ITEMS || (force && pendingItems.length > 0))) {
    const chunkId = nextChunkId++;
    const items = pendingItems.splice(0, CHUNK_ITEMS);
    inFlightChunkIds.add(chunkId);
    self.postMessage({
      type: 'CHUNK',
      importId: currentImportId,
      chunkId: chunkId,
      items: items,
      targetTable: 'channels'
    });
  }
  checkCompletion();
}

function checkCompletion() {
  // Flux terminé + aucun lot en vol + file vide → terminaison unique.
  if (isStreamEnded && inFlightChunkIds.size === 0 && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    currentImportId = null;
    if (groupOrder.length > 0) {
      const cats = [];
      for (let g = 0; g < groupOrder.length; g++) cats.push({ name: groupOrder[g] });
      self.postMessage({ type: 'CATEGORIES', importId: importId, playlistId: playlistId,
                         kind: 'live', categories: cats });
    }
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'playlist' });
  }
}
