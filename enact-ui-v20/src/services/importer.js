import { iptvDb } from './iptvDb';

const CHUNK_ITEMS = 2000;
const MAX_CHUNKS_IN_FLIGHT = 2;

function text(value) {
  return value == null ? '' : String(value);
}

function searchName(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function baseUrl(value) {
  return text(value).trim().replace(/\/+$/, '');
}

function waitFrame() {
  return new Promise(function (resolve) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(function () { resolve(); });
    else setTimeout(resolve, 0);
  });
}

function report(onProgress, phase, message, current, total) {
  if (typeof onProgress !== 'function') return;
  const max = Number(total || 0);
  const done = Number(current || 0);
  onProgress({
    phase: phase,
    message: message,
    current: done,
    total: max,
    percent: max > 0 ? Math.max(0, Math.min(100, Math.round(done * 100 / max))) : 0
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP_' + response.status);
  const value = await response.json();
  return value;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP_' + response.status);
  return response.text();
}

function xtreamUrl(profile, action, categoryId) {
  let url = baseUrl(profile.base) + '/player_api.php?username=' + encodeURIComponent(profile.username || '') +
    '&password=' + encodeURIComponent(profile.password || '');
  if (action) url += '&action=' + encodeURIComponent(action);
  if (categoryId != null) url += '&category_id=' + encodeURIComponent(categoryId);
  return url;
}

function categoryMap(rows) {
  const map = Object.create(null);
  (rows || []).forEach(function (row) {
    if (row && row.category_id != null) map[String(row.category_id)] = text(row.category_name || 'Autres');
  });
  return map;
}

function categoryRows(importId, kind, rows) {
  const seen = Object.create(null);
  return (rows || []).map(function (row, index) {
    const name = text(row && row.category_name || 'Autres');
    if (seen[name]) return null;
    seen[name] = true;
    return { importId: importId, kind: kind, name: name, sort: index };
  }).filter(Boolean);
}

async function fetchXtreamCatalog(profile, globalAction, categoryAction, categories, onProgress, label) {
  try {
    const globalRows = await fetchJson(xtreamUrl(profile, globalAction));
    if (Array.isArray(globalRows)) return globalRows;
  } catch (error) {
    // V20 fallback : certains fournisseurs refusent les endpoints globaux.
  }
  const output = [];
  const seen = Object.create(null);
  for (let i = 0; i < (categories || []).length; i++) {
    const category = categories[i];
    report(onProgress, 'catalogue', label + ' — catégorie ' + (i + 1) + '/' + categories.length, i, categories.length);
    try {
      const rows = await fetchJson(xtreamUrl(profile, categoryAction, category.category_id));
      if (Array.isArray(rows)) {
        rows.forEach(function (row) {
          const key = text(row && (row.stream_id != null ? row.stream_id : row.series_id));
          if (!seen[key]) { seen[key] = true; output.push(row); }
        });
      }
    } catch (error) {
      // Une catégorie fournisseur indisponible ne bloque pas les autres.
    }
    await waitFrame();
  }
  return output;
}

function mapXtreamRows(rows, kind, importId, profile, groups) {
  const base = baseUrl(profile.base);
  return (rows || []).map(function (row, index) {
    const groupName = text(groups[String(row && row.category_id)] || 'Autres');
    const name = text(row && row.name || 'Sans titre');
    if (kind === 'live') {
      const streamId = text(row.stream_id);
      return {
        id: importId + ':' + streamId,
        importId: importId,
        sortIdx: index,
        name: name,
        channelId: row.epg_channel_id ? text(row.epg_channel_id) : null,
        groupName: groupName,
        logo: text(row.stream_icon),
        streamUrl: base + '/live/' + encodeURIComponent(profile.username) + '/' + encodeURIComponent(profile.password) + '/' + encodeURIComponent(streamId) + '.m3u8',
        searchName: searchName(name)
      };
    }
    if (kind === 'vod') {
      const streamId = text(row.stream_id);
      return {
        id: importId + ':' + streamId,
        importId: importId,
        sortIdx: index,
        name: name,
        groupName: groupName,
        logo: text(row.stream_icon),
        streamUrl: base + '/movie/' + encodeURIComponent(profile.username) + '/' + encodeURIComponent(profile.password) + '/' + encodeURIComponent(streamId) + '.' + text(row.container_extension || 'mp4'),
        searchName: searchName(name),
        rating: text(row.rating),
        releaseDate: text(row.releaseDate || row.release_date),
        plot: text(row.plot || row.description)
      };
    }
    const seriesId = text(row.series_id);
    return {
      id: importId + ':' + seriesId,
      importId: importId,
      sortIdx: index,
      seriesId: seriesId,
      name: name,
      groupName: groupName,
      logo: text(row.cover || row.stream_icon),
      plot: text(row.plot),
      rating: text(row.rating),
      releaseDate: text(row.releaseDate || row.release_date),
      searchName: searchName(name)
    };
  });
}

function parseM3u(value, importId) {
  const lines = text(value).split(/\r?\n/);
  const rows = [];
  let pending = null;
  let sequence = 0;
  lines.forEach(function (raw) {
    const line = raw.trim();
    if (!line) return;
    if (line.indexOf('#EXTINF') === 0) {
      const comma = line.indexOf(',');
      const attrs = comma >= 0 ? line.substring(0, comma) : line;
      const name = comma >= 0 ? line.substring(comma + 1).trim() : '';
      const attr = function (key) {
        const match = new RegExp(key + '=["\\\']([^"\\\']*)["\\\']', 'i').exec(attrs);
        return match ? match[1] : '';
      };
      pending = { name: name || 'Sans titre', channelId: attr('tvg-id'), logo: attr('tvg-logo'), groupName: attr('group-title') || 'Autres' };
      return;
    }
    if (line.indexOf('#EXTGRP') === 0) {
      if (pending) pending.groupName = line.substring(7).replace(/^:/, '').trim() || pending.groupName;
      return;
    }
    if (line.charAt(0) === '#') return;
    const item = pending || { name: line.substring(line.lastIndexOf('/') + 1), channelId: '', logo: '', groupName: 'Autres' };
    rows.push({
      id: importId + ':' + sequence,
      importId: importId,
      sortIdx: sequence,
      name: item.name,
      channelId: item.channelId || null,
      groupName: item.groupName || 'Autres',
      logo: item.logo || '',
      streamUrl: line,
      searchName: searchName(item.name)
    });
    sequence += 1;
    pending = null;
  });
  return rows;
}

function xmlAttribute(attrs, name) {
  const match = new RegExp('\\b' + name + '=["\\\']([^"\\\']*)["\\\']', 'i').exec(attrs || '');
  return match ? match[1] : '';
}

function xmlText(value) {
  let output = text(value).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(output);
  if (cdata) output = cdata[1];
  return output.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function xmlDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/.exec(text(value).trim());
  if (!match) return null;
  let utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  if (match[7]) {
    const sign = match[7].charAt(0) === '-' ? -1 : 1;
    utc -= sign * (Number(match[7].substring(1, 3)) * 3600 + Number(match[7].substring(3, 5)) * 60) * 1000;
  }
  return Number.isNaN(utc) ? null : utc;
}

function parseXmltv(value, importId) {
  const rows = [];
  const seen = Object.create(null);
  const regex = /<programme\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/programme>/gi;
  let match;
  while ((match = regex.exec(text(value))) !== null) {
    const attrs = match[1];
    const body = match[2];
    const channelId = xmlAttribute(attrs, 'channel');
    const startTime = xmlDate(xmlAttribute(attrs, 'start'));
    const stopTime = xmlDate(xmlAttribute(attrs, 'stop'));
    if (!channelId || startTime === null || stopTime === null) continue;
    const id = importId + ':' + channelId + ':' + startTime;
    if (seen[id]) continue;
    seen[id] = true;
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    rows.push({ id: id, importId: importId, channelId: channelId, startTime: startTime, stopTime: stopTime, title: xmlText(titleMatch ? titleMatch[1] : '') });
  }
  return rows;
}

async function writeChunks(tableName, rows, onProgress, phase, label, totalBase, totalOffset) {
  let completed = 0;
  const jobs = [];
  for (let i = 0; i < rows.length; i += CHUNK_ITEMS) {
    const chunk = rows.slice(i, i + CHUNK_ITEMS);
    jobs.push(iptvDb[tableName].bulkAdd(chunk).then(function () {
      completed += chunk.length;
      report(onProgress, phase, label + ' — ' + completed + '/' + rows.length, totalOffset + completed, totalBase);
    }));
    if (jobs.length >= MAX_CHUNKS_IN_FLIGHT) {
      await Promise.all(jobs.splice(0, jobs.length));
      await waitFrame();
    }
  }
  if (jobs.length) await Promise.all(jobs);
  await waitFrame();
}

async function writeCategories(importId, categories, onProgress) {
  if (!categories.length) return;
  report(onProgress, 'categories', 'Écriture des catégories…', 0, categories.length);
  await iptvDb.categories.bulkAdd(categories);
  report(onProgress, 'categories', 'Catégories écrites', categories.length, categories.length);
}

async function purgeImport(importId, kind) {
  const tables = kind === 'epg' ? ['epg'] : ['channels', 'vod', 'series', 'series_info', 'categories'];
  for (let i = 0; i < tables.length; i++) {
    await iptvDb[tables[i]].where('importId').equals(importId).delete();
  }
  await iptvDb.imports.delete(importId);
}

function scheduleOldImportCleanup(playlistId, currentId, kind, oldIds) {
  if (!oldIds.length) return;
  setTimeout(async function () {
    try {
      const profile = await iptvDb.playlists.get(playlistId);
      const active = kind === 'epg' ? profile && profile.activeEpgImportId : profile && profile.activeImportId;
      const safe = oldIds.filter(function (id) { return id !== currentId && id !== active; });
      for (let i = 0; i < safe.length; i++) {
        const tables = kind === 'epg' ? ['epg'] : ['channels', 'vod', 'series', 'series_info', 'categories'];
        for (let t = 0; t < tables.length; t++) await iptvDb[tables[t]].where('importId').equals(safe[i]).delete();
        await iptvDb.imports.delete(safe[i]);
      }
    } catch (error) {
      // La maintenance native V20 pourra reprendre cette purge au prochain boot.
    }
  }, 0);
}

async function completeImport(profile, importId, kind, onProgress) {
  const activeField = kind === 'epg' ? 'activeEpgImportId' : 'activeImportId';
  const oldIds = await iptvDb.imports.where('playlistId').equals(profile.id).and(function (row) {
    return row.kind === kind && row.id !== importId;
  }).primaryKeys();
  await iptvDb.transaction('rw', [iptvDb.playlists, iptvDb.imports], async function () {
    const update = { updatedAt: Date.now() };
    update[activeField] = importId;
    await iptvDb.playlists.update(profile.id, update);
    await iptvDb.imports.update(importId, { status: 'completed' });
  });
  scheduleOldImportCleanup(profile.id, importId, kind, oldIds);
  report(onProgress, kind === 'epg' ? 'epg-complete' : 'complete', kind === 'epg' ? 'EPG importé' : 'Chaînes, VOD et séries importés', 100, 100);
}

async function importPlaylist(profile, onProgress) {
  const oldProfile = await iptvDb.playlists.get(profile.id);
  const importId = await iptvDb.imports.add({ playlistId: profile.id, kind: 'playlist', status: 'running', createdAt: Date.now() });
  try {
    let channels = [];
    let movies = [];
    let series = [];
    let categoriesForImport = [];
    if (profile.source === 'xtream') {
      report(onProgress, 'auth', 'Connexion Xtream…', 0, 0);
      const account = await fetchJson(xtreamUrl(profile));
      if (!account || !account.user_info || String(account.user_info.status).toLowerCase() !== 'active') throw new Error('XTREAM_AUTH_FAILED');
      report(onProgress, 'categories', 'Lecture des catégories serveur…', 0, 0);
      const categoryLists = await Promise.all([
        fetchJson(xtreamUrl(profile, 'get_live_categories')).catch(function () { return []; }),
        fetchJson(xtreamUrl(profile, 'get_vod_categories')).catch(function () { return []; }),
        fetchJson(xtreamUrl(profile, 'get_series_categories')).catch(function () { return []; })
      ]);
      const liveCategories = Array.isArray(categoryLists[0]) ? categoryLists[0] : [];
      const vodCategories = Array.isArray(categoryLists[1]) ? categoryLists[1] : [];
      const seriesCategories = Array.isArray(categoryLists[2]) ? categoryLists[2] : [];
      categoriesForImport = categoriesForImport.concat(categoryRowsFor(importId, 'live', liveCategories), categoryRowsFor(importId, 'vod', vodCategories), categoryRowsFor(importId, 'series', seriesCategories));
      const liveRaw = await fetchXtreamCatalog(profile, 'get_live_streams', 'get_live_streams', liveCategories, onProgress, 'Chaînes');
      channels = mapXtreamRows(liveRaw, 'live', importId, profile, categoryMap(liveCategories));
      await writeCategories(importId, categoriesForImport, onProgress);
      const vodRaw = await fetchXtreamCatalog(profile, 'get_vod_streams', 'get_vod_streams', vodCategories, onProgress, 'Films');
      movies = mapXtreamRows(vodRaw, 'vod', importId, profile, categoryMap(vodCategories));
      const seriesRaw = await fetchXtreamCatalog(profile, 'get_series', 'get_series', seriesCategories, onProgress, 'Séries');
      series = mapXtreamRows(seriesRaw, 'series', importId, profile, categoryMap(seriesCategories));
    } else {
      report(onProgress, 'playlist', 'Téléchargement de la playlist M3U…', 0, 0);
      channels = parseM3u(await fetchText(profile.m3uUrl), importId);
      const names = [];
      const seen = Object.create(null);
      channels.forEach(function (row) { if (!seen[row.groupName]) { seen[row.groupName] = true; names.push(row.groupName); } });
      categoriesForImport = names.map(function (name, index) { return { importId: importId, kind: 'live', name: name, sort: index }; });
      await writeCategories(importId, categoriesForImport, onProgress);
    }
    const total = channels.length + movies.length + series.length;
    report(onProgress, 'write-live', 'Écriture des chaînes…', 0, total);
    await writeChunks('channels', channels, onProgress, 'write-live', 'Chaînes écrites', total, 0);
    report(onProgress, 'write-vod', 'Écriture des films…', channels.length, total);
    await writeChunks('vod', movies, onProgress, 'write-vod', 'Films écrits', total, channels.length);
    report(onProgress, 'write-series', 'Écriture des séries…', channels.length + movies.length, total);
    await writeChunks('series', series, onProgress, 'write-series', 'Séries écrites', total, channels.length + movies.length);
    await completeImport(oldProfile, importId, 'playlist', onProgress);
    return await iptvDb.playlists.get(profile.id);
  } catch (error) {
    await purgeImport(importId, 'playlist').catch(function () {});
    throw error;
  }
}

function categoryRowsFor(importId, kind, rows) {
  return categoryRows(importId, kind, rows);
}

async function importEpg(profile, onProgress) {
  if (!profile.epgUrl) {
    report(onProgress, 'epg-skip', 'Aucune URL EPG configurée', 100, 100);
    return profile;
  }
  const importId = await iptvDb.imports.add({ playlistId: profile.id, kind: 'epg', status: 'running', createdAt: Date.now() });
  try {
    report(onProgress, 'epg', 'Téléchargement du guide EPG…', 0, 0);
    const rows = parseXmltv(await fetchText(profile.epgUrl), importId);
    report(onProgress, 'epg', 'Écriture des programmes EPG…', 0, rows.length);
    await writeChunks('epg', rows, onProgress, 'epg', 'Programmes EPG écrits', rows.length, 0);
    await completeImport(profile, importId, 'epg', onProgress);
    return await iptvDb.playlists.get(profile.id);
  } catch (error) {
    await purgeImport(importId, 'epg').catch(function () {});
    throw error;
  }
}

export async function importProfileAndEpg(profileId, onProgress) {
  let profile = await iptvDb.playlists.get(profileId);
  if (!profile) throw new Error('Profil introuvable');
  profile = await importPlaylist(profile, onProgress);
  profile = await importEpg(profile, onProgress);
  return profile;
}
