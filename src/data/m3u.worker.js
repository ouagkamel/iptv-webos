// src/data/m3u.worker.js — protocole §5.2 + tokenisation §6.4 (#EXTINF/#EXTGRP),
// id = importId + ':' + seq (DB-1), searchName normalisé (DB-3).
// Le carryOver porte sur la DERNIÈRE LIGNE incomplète : un paquet réseau peut
// couper une ligne #EXTINF en deux — jamais un item à cheval sur deux chunks.
// CHUNK_ITEMS : taille de lot (V10, §5.2) — la sémantique PROT-1 (un seul CHUNK
// en vol) est inchangée ; gain = coût fixe d'acquittement/respiration ÷ 4.
const CHUNK_ITEMS = 2000;

let lineCarry = '';
let pendingName = null;     // #EXTINF vue, stream pas encore lu
let pendingGroup = null;    // #EXTGRP ou group-title de l'EXTINF courant
let pendingChannelId = null;
let pendingLogo = null;
let seq = 0;

let isWaitingForAck = false;
let pendingItems = [];
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
    pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
    seq = 0;
    pendingItems = [];
    isWaitingForAck = false;
    isStreamEnded = false;
    return;
  }

  if (type === 'CHUNK_COMMITTED') {
    if (data.importId !== currentImportId) return; // PROT-2
    isWaitingForAck = false;
    flushPendingItems(isStreamEnded);               // PROT-4
    return;
  }

  if (type === 'PARSE_CHUNK') {
    if (data.importId !== currentImportId) return;
    parseChunk(data.xmlChunk, false);
    self.postMessage({ type: 'CHUNK_PARSED', importId: currentImportId }); // watermark §5.7
    return;
  }

  if (type === 'END_OF_STREAM') {
    if (data.importId !== currentImportId) return;
    isStreamEnded = true;
    parseChunk('', true);      // solde la dernière ligne ; un #EXTINF sans URL est écarté
    flushPendingItems(true);   // drain forcé du résiduel (< 500)
    checkCompletion();
    return;
  }

  if (type === 'ABORT_IMPORT') {
    if (data.importId !== null && data.importId !== currentImportId) return;
    currentImportId = null;
    pendingItems = [];
    lineCarry = '';
    pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
    isWaitingForAck = false;
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
    handleLine(last, true);
  }
  for (let i = 0; i < lines.length; i++) {
    handleLine(lines[i], false);
    if (pendingItems.length >= CHUNK_ITEMS) flushPendingItems(false); // PROT-1 : max 1 CHUNK en vol
  }
}

function attr(str, name) {
  const m = new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i').exec(str || '');
  return m ? m[1] : null;
}

function handleLine(rawLine, isFinal) {
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
    pendingGroup = g !== null ? g : null; // #EXTGRP éventuel prendra le dessus ci-dessous
    return;
  }

  if (line.indexOf('#EXTGRP') === 0) {
    pendingGroup = line.substring(7).replace(/^:/, '').trim() || pendingGroup;
    return;
  }

  if (line.charAt(0) === '#') return; // autres directives (#EXTVLCOPT, #EXTM3U…) ignorées

  // Ligne stream : l'item se concrétise (un nom est optionnel → repli sur l'URL)
  const name = pendingName !== null ? pendingName : line.substring(line.lastIndexOf('/') + 1);
  pendingItems.push({
    id: currentImportId + ':' + seq, // DB-1 : seq = compteur incrémental dans le fichier
    importId: currentImportId,
    name: name,
    channelId: pendingChannelId,      // jointure EPG (tvg-id)
    groupName: pendingGroup || 'Autres',
    logo: pendingLogo || '',
    streamUrl: line,
    searchName: normalizeSearchName(name) // DB-3
  });
  seq += 1;
  pendingName = null; pendingGroup = null; pendingChannelId = null; pendingLogo = null;
}

function normalizeSearchName(name) {
  // Règle DB-3 — minuscules + diacritiques retirés
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function flushPendingItems(force) {
  if (isWaitingForAck || pendingItems.length === 0) {
    checkCompletion();
    return;
  }
  if (pendingItems.length >= CHUNK_ITEMS || force) {
    isWaitingForAck = true;
    const items = pendingItems.splice(0, CHUNK_ITEMS);
    self.postMessage({ type: 'CHUNK', importId: currentImportId, items: items, targetTable: 'channels' });
  } else {
    checkCompletion();
  }
}

function checkCompletion() {
  // PROT-3 : flux terminé + dernier ack reçu + file vide → terminaison unique
  if (isStreamEnded && !isWaitingForAck && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    currentImportId = null; // jamais de double COMPLETE (file d'acks résiduels)
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'playlist' });
  }
}
