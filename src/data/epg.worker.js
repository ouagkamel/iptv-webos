// src/data/epg.worker.js — parsing XMLTV, carryOver, dates 12/14 chiffres,
// offsets ±HHMM et CDATA/entités.
//
// V18 : deux CHUNK IndexedDB en vol. Le parsing XMLTV peut remplir le second
// lot pendant que DataManager sérialise l'écriture du premier.
const CHUNK_ITEMS = 2000;
const MAX_CHUNKS_IN_FLIGHT = 2;

let carryOver = '';
let pendingItems = [];
let inFlightChunkIds = new Set();
let nextChunkId = 0;
let currentImportId = null;
let currentPlaylistId = null;
let isStreamEnded = false;

self.onmessage = function (e) {
  const { type, importId, playlistId, xmlChunk } = e.data;

  if (type === 'INIT_IMPORT') {
    currentImportId = importId;
    currentPlaylistId = playlistId;
    carryOver = '';
    pendingItems = [];
    inFlightChunkIds = new Set();
    nextChunkId = 0;
    isStreamEnded = false;
    return;
  }

  if (type === 'CHUNK_COMMITTED') {
    if (importId !== currentImportId) return;
    if (!inFlightChunkIds.has(e.data.chunkId)) return;
    inFlightChunkIds.delete(e.data.chunkId);
    flushPendingItems(isStreamEnded);
    checkCompletion();
    return;
  }

  if (type === 'PARSE_CHUNK') {
    if (importId !== currentImportId) return;
    parseChunk(xmlChunk);
    self.postMessage({ type: 'CHUNK_PARSED', importId: currentImportId });
    return;
  }

  if (type === 'END_OF_STREAM') {
    if (importId !== currentImportId) return;
    isStreamEnded = true;
    parseChunk('');
    flushPendingItems(true);
    checkCompletion();
    return;
  }

  if (type === 'ABORT_IMPORT') {
    if (importId !== null && importId !== currentImportId) return;
    currentImportId = null;
    pendingItems = [];
    carryOver = '';
    inFlightChunkIds.clear();
    isStreamEnded = false;
  }
};

function parseChunk(chunk) {
  // Conserve intégralement tout fragment non fermé pour le chunk suivant.
  const text = carryOver + chunk;
  const lastCloseIndex = text.lastIndexOf('</programme>');

  if (lastCloseIndex === -1) {
    carryOver = text;
    return;
  }

  const processableText = text.substring(0, lastCloseIndex + 12);
  carryOver = text.substring(lastCloseIndex + 12);

  // Tolère un '>' littéral dans une valeur d'attribut quotée.
  const programmeRegex = /<programme\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/programme>/g;
  let match;

  while ((match = programmeRegex.exec(processableText)) !== null) {
    const attrString = match[1];
    const bodyString = match[2];

    const channel = getAttribute(attrString, 'channel');
    const startTime = parseXMLTVDateToUTC(getAttribute(attrString, 'start'));
    const stopTime = parseXMLTVDateToUTC(getAttribute(attrString, 'stop'));

    if (channel && startTime !== null && stopTime !== null) {
      pendingItems.push({
        id: currentImportId + ':' + channel + ':' + startTime,
        importId: currentImportId,
        channelId: channel,
        startTime: startTime,
        stopTime: stopTime,
        title: extractTagText(bodyString, 'title')
      });
    }

    if (pendingItems.length >= CHUNK_ITEMS) flushPendingItems(false);
  }
}

function getAttribute(attrString, name) {
  const reg = new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i');
  const m = reg.exec(attrString);
  return m ? m[1] : null;
}

function extractTagText(body, tagName) {
  const reg = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i');
  const m = reg.exec(body);
  if (!m) return '';

  let text = m[1].trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  if (cdataMatch) text = cdataMatch[1];

  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function parseXMLTVDateToUTC(str) {
  if (!str) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/.exec(String(str).trim());
  if (!m) return null;

  let utc = Date.UTC(
    parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
    parseInt(m[4], 10), parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0
  );

  if (m[7]) {
    const sign = m[7].charAt(0) === '-' ? -1 : 1;
    const offH = parseInt(m[7].substr(1, 2), 10);
    const offM = parseInt(m[7].substr(3, 2), 10);
    utc -= sign * (offH * 3600 + offM * 60) * 1000;
  }

  return isNaN(utc) ? null : utc;
}

function flushPendingItems(force) {
  while (inFlightChunkIds.size < MAX_CHUNKS_IN_FLIGHT &&
         (pendingItems.length >= CHUNK_ITEMS || (force && pendingItems.length > 0))) {
    const chunkId = nextChunkId++;
    const chunkToSend = pendingItems.splice(0, CHUNK_ITEMS);
    inFlightChunkIds.add(chunkId);
    self.postMessage({
      type: 'CHUNK',
      importId: currentImportId,
      chunkId: chunkId,
      items: chunkToSend,
      targetTable: 'epg'
    });
  }
  checkCompletion();
}

function checkCompletion() {
  if (isStreamEnded && inFlightChunkIds.size === 0 && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'epg' });
    currentImportId = null;
  }
}
