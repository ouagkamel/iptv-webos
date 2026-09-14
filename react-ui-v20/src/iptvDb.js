import Dexie from 'dexie';

// Contrat de données de la release native V20 : même base IndexedDB,
// mêmes stores V1→V4, mêmes importId/activeImportId et mêmes URL de flux.
// La variante React ne crée aucun catalogue de démonstration. Elle lit les
// profils, imports, catalogues, EPG et cache de séries persistés par V20.
export const iptvDb = new Dexie('IPTVDatabase');

iptvDb.version(1).stores({
  playlists: '++id, name, activeImportId, activeEpgImportId, updatedAt',
  imports: '++id, playlistId, kind, status, createdAt',
  channels: 'id, importId, [importId+groupName], channelId, searchName',
  epg: 'id, [importId+channelId+startTime], importId, stopTime'
});
iptvDb.version(2).stores({ vod: 'id, importId, [importId+groupName], searchName' });
iptvDb.version(3).stores({
  series: 'id, importId, [importId+groupName], searchName',
  series_info: 'id, importId',
  categories: '++cid, importId, [importId+kind]'
});
iptvDb.version(4).stores({
  channels: 'id, importId',
  vod: 'id, importId',
  series: 'id, importId'
});
export async function readProfiles() {
  return iptvDb.playlists.orderBy('updatedAt').reverse().toArray();
}

export async function readProfileData(profile) {
  if (!profile || !profile.activeImportId) {
    return { profile, channels: [], movies: [], series: [], favorites: [], epg: [], episodes: [] };
  }
  const importId = profile.activeImportId;
  const [channels, movies, series, favorites] = await Promise.all([
    readCatalog('channels', importId, 'live'),
    readCatalog('vod', importId, 'vod'),
    readCatalog('series', importId, 'series'),
    iptvDb.favorites ? iptvDb.favorites.where('playlistId').equals(profile.id).sortBy('createdAt') : []
  ]);
  let epg = [];
  if (profile.activeEpgImportId) {
    epg = await iptvDb.epg.where('importId').equals(profile.activeEpgImportId).toArray();
  }
  const episodes = await readLatestEpisodes(profile, series);
  return { profile, channels: channels, movies: movies, series: series, favorites: favorites || [], epg, episodes };
}

async function readCatalog(tableName, importId, kind) {
  const rows = await iptvDb[tableName].where('importId').equals(importId).toArray();
  let categories = [];
  try {
    categories = await iptvDb.categories.where('[importId+kind]').equals([importId, kind]).sortBy('sort');
  } catch (error) {
    categories = [];
  }
  const rank = Object.create(null);
  categories.forEach(function (category, index) { rank[String(category.name)] = index; });
  return (rows || []).slice().sort(function (a, b) {
    const ar = Object.prototype.hasOwnProperty.call(rank, String(a.groupName || '')) ? rank[String(a.groupName || '')] : 1000000;
    const br = Object.prototype.hasOwnProperty.call(rank, String(b.groupName || '')) ? rank[String(b.groupName || '')] : 1000000;
    if (ar !== br) return ar - br;
    return Number(a.sortIdx || 0) - Number(b.sortIdx || 0);
  });
}

async function readLatestEpisodes(profile, seriesRows) {
  if (!profile || profile.source !== 'xtream' || !seriesRows.length) return [];
  const cached = await iptvDb.series_info.where('importId').equals(profile.activeImportId).toArray();
  const cacheMap = Object.create(null);
  cached.forEach(function (row) { cacheMap[row.id] = row.payload; });
  const result = [];
  for (let i = 0; i < Math.min(seriesRows.length, 8); i++) {
    const series = seriesRows[i];
    let payload = cacheMap[series.id] || null;
    if (!payload) {
      try {
        const url = seriesInfoUrl(profile, series.seriesId);
        const response = await fetch(url);
        if (response.ok) {
          const json = await response.json();
          payload = normalizeSeriesInfo(json);
          await iptvDb.series_info.put({
            id: series.id,
            importId: series.importId,
            playlistId: profile.id,
            formatVersion: 2,
            payload: payload,
            fetchedAt: Date.now()
          });
        }
      } catch (error) {
        // Une série indisponible ne bloque pas le reste de l'écran.
      }
    }
    const latest = latestEpisode(series, payload);
    if (latest) result.push(latest);
  }
  return result.sort(function (a, b) {
    const seasonDiff = Number(b.season.number || 0) - Number(a.season.number || 0);
    if (seasonDiff) return seasonDiff;
    return Number(b.episode.episodeId || 0) - Number(a.episode.episodeId || 0);
  });
}

function seriesInfoUrl(profile, seriesId) {
  const base = String(profile.base || '').replace(/\/+$/, '');
  return base + '/player_api.php?username=' + encodeURIComponent(profile.username || '') +
    '&password=' + encodeURIComponent(profile.password || '') + '&action=get_series_info&series_id=' + encodeURIComponent(seriesId || '');
}

function normalizeSeriesInfo(json) {
  const seasons = [];
  const episodesBySeason = json && json.episodes ? json.episodes : {};
  Object.keys(episodesBySeason).forEach(function (key) {
    const number = Number(key) || 1;
    const list = Array.isArray(episodesBySeason[key]) ? episodesBySeason[key] : [];
    const episodes = list.map(function (episode) {
      return {
        id: String(episode.id || episode.episode_id || ''),
        episodeId: String(episode.episode_num || episode.episode_id || ''),
        title: String(episode.title || (episode.info && episode.info.name) || 'Épisode'),
        ext: String(episode.container_extension || 'mp4'),
        plot: String(episode.plot || (episode.info && episode.info.plot) || '')
      };
    }).filter(function (episode) { return episode.id; });
    if (episodes.length) seasons.push({ number: number, name: 'Saison ' + number, episodes: episodes });
  });
  return { seasons: seasons };
}

function latestEpisode(series, payload) {
  if (!payload || !payload.seasons) return null;
  let best = null;
  payload.seasons.forEach(function (season) {
    (season.episodes || []).forEach(function (episode) {
      if (!best || Number(season.number) > Number(best.season.number) ||
          (Number(season.number) === Number(best.season.number) && Number(episode.episodeId) > Number(best.episode.episodeId))) {
        best = { series: series, season: season, episode: episode };
      }
    });
  });
  return best;
}

export function episodeUrl(profile, episode) {
  const base = String(profile.base || '').replace(/\/+$/, '');
  return base + '/series/' + encodeURIComponent(profile.username || '') + '/' +
    encodeURIComponent(profile.password || '') + '/' + encodeURIComponent(episode.id) + '.' + encodeURIComponent(episode.ext || 'mp4');
}

export function currentProgram(channel, epg) {
  if (!channel || !channel.channelId) return null;
  const now = Date.now();
  return (epg || []).filter(function (row) {
    return String(row.channelId) === String(channel.channelId) && Number(row.startTime) <= now && Number(row.stopTime) >= now;
  }).sort(function (a, b) { return Number(a.startTime) - Number(b.startTime); })[0] || null;
}

export function matchPrograms(channels, epg) {
  const byChannel = Object.create(null);
  (channels || []).forEach(function (channel) { if (channel.channelId) byChannel[String(channel.channelId)] = channel; });
  const now = Date.now();
  const isMatch = function (row, channel) {
    const text = String(row.title || '') + ' ' + String(channel && channel.name || '') + ' ' + String(channel && channel.groupName || '');
    return /\b(?:vs|contre|match|football|soccer|f[ou]t|rugby|basket(?:ball)?|tennis|handball|volley|hockey|baseball|golf|formula\s*1|f1|ligue|liga|champions|premier\s+league|cup)\b/i.test(text);
  };
  return (epg || []).filter(function (row) {
    const channel = byChannel[String(row.channelId)];
    return channel && Number(row.startTime) <= now && Number(row.stopTime) >= now && isMatch(row, channel);
  }).map(function (row) { return { channel: byChannel[String(row.channelId)], program: row }; });
}

export async function createProfile(form) {
  const name = String(form.name || '').trim() || (form.source === 'xtream' ? 'Compte Xtream' : 'Playlist M3U');
  const row = { name: name, source: form.source === 'xtream' ? 'xtream' : 'm3u', updatedAt: Date.now() };
  if (row.source === 'xtream') {
    row.base = String(form.base || '').trim().replace(/\/+$/, '');
    row.username = String(form.username || '').trim();
    row.password = String(form.password || '');
    row.epgUrl = row.base + '/xmltv.php?username=' + encodeURIComponent(row.username) + '&password=' + encodeURIComponent(row.password);
    if (!row.base || !row.username || !row.password) throw new Error('Renseignez le serveur, le nom d’utilisateur et le mot de passe.');
  } else {
    row.m3uUrl = String(form.url || '').trim();
    row.epgUrl = String(form.epgUrl || '').trim() || null;
    if (!/^https?:\/\//i.test(row.m3uUrl)) throw new Error('L’URL M3U doit commencer par http:// ou https://.');
  }
  return iptvDb.playlists.add(row);
}
