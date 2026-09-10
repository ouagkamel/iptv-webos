// src/data/epg.worker.js — spec §6.1 (verbatim).
// CarryOver texte, regex tolérante '>' dans valeurs quotées, attributs sans ordre,
// CDATA/entités (&amp; en dernier), dates 12/14 chiffres + offset ±HHMM, PROT-1…4.
// CHUNK_ITEMS : lot 2000 (V10, §5.2) — PROT-1 inchangé (un seul CHUNK en vol).
const CHUNK_ITEMS = 2000;

let carryOver = '';
let isWaitingForAck = false;
let pendingItems = [];
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
    isWaitingForAck = false;
    isStreamEnded = false;
    return;
  }

  if (type === 'CHUNK_COMMITTED') {
    if (importId !== currentImportId) return; // PROT-2 : ack tardif d'import mort
    isWaitingForAck = false;
    flushPendingItems(isStreamEnded); // PROT-4 : drain des restes en fin de flux
    return;
  }

  if (type === 'PARSE_CHUNK') {
    if (importId !== currentImportId) return;
    parseChunk(xmlChunk);
    self.postMessage({ type: 'CHUNK_PARSED', importId: currentImportId }); // watermark §5.7
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
    isWaitingForAck = false;
    isStreamEnded = false;
  }
};

function parseChunk(chunk) {
  // Conserve intégralement tout fragment non fermé pour le chunk suivant :
  // un paquet réseau peut couper <programme …> n'importe où.
  const text = carryOver + chunk;
  const lastCloseIndex = text.lastIndexOf('</programme>');

  if (lastCloseIndex === -1) {
    carryOver = text;
    return;
  }

  const processableText = text.substring(0, lastCloseIndex + 12); // '</programme>'.length === 12
  carryOver = text.substring(lastCloseIndex + 12);

  // Tolère un '>' littéral placé DANS une valeur d'attribut quotée (légal en XML,
  // l'échappement obligatoire ne concerne que '<' et '&') — capture adaptée en conséquence
  const programmeRegex = /<programme\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/programme>/g;
  let match;

  while ((match = programmeRegex.exec(processableText)) !== null) {
    const attrString = match[1];
    const bodyString = match[2];

    const channel = getAttribute(attrString, 'channel');
    const startTime = parseXMLTVDateToUTC(getAttribute(attrString, 'start'));
    const stopTime = parseXMLTVDateToUTC(getAttribute(attrString, 'stop'));

    // Attributs absents ou dates invalides → item ignoré (jamais de epoch 0 en base)
    if (channel && startTime !== null && stopTime !== null) {
      pendingItems.push({
        id: currentImportId + ':' + channel + ':' + startTime, // DB-1
        importId: currentImportId,
        channelId: channel,
        startTime: startTime,
        stopTime: stopTime,
        title: extractTagText(bodyString, 'title')
      });
    }

    if (pendingItems.length >= CHUNK_ITEMS) {
      flushPendingItems(false);
    }
  }
}

function getAttribute(attrString, name) {
  // Ordre des attributs XML non garanti + apostrophes légales en XML
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
    .replace(/&amp;/g, '&')   // &amp; EN DERNIER (ordre des unescape)
    .trim();
}

function parseXMLTVDateToUTC(str) {
  // Format XMLTV : YYYYMMDDHHMMSS ±HHMM (offset optionnel) → epoch UTC ms
  if (!str) return null;
  // Secondes optionnelles : certains grabbers émettent des dates à 12 chiffres (sans SS)
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
    utc -= sign * (offH * 3600 + offM * 60) * 1000; // "18:00 +0100" → 17:00 UTC
  }

  return isNaN(utc) ? null : utc;
}

function flushPendingItems(force) {
  if (isWaitingForAck || pendingItems.length === 0) {
    checkCompletion();
    return;
  }
  if (pendingItems.length >= CHUNK_ITEMS || force) {
    isWaitingForAck = true;
    const chunkToSend = pendingItems.splice(0, CHUNK_ITEMS);
    self.postMessage({
      type: 'CHUNK',
      importId: currentImportId,
      items: chunkToSend,
      targetTable: 'epg'
    });
  } else {
    checkCompletion();
  }
}

function checkCompletion() {
  // PROT-3 : dernier ack reçu, file vide, flux terminé → terminaison
  if (isStreamEnded && !isWaitingForAck && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'epg' });
  }
}
