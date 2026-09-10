// src/services/SeriesBrowser.js — spec §6.6 (V11). Détail des séries Xtream :
// LAZY (jamais à l'import) et cache local (db.series_info, TTL 24 h). Un appel
// réseau unitaire par série ouverte — hors protocole d'import §5.2 : petit JSON,
// pas de CHUNK, pas d'ack ; un échec n'affecte jamais l'import ni les autres vues.
import { db } from '../data/db.js';
import { XtreamClient } from '../platform/XtreamClient.js';

const INFO_TTL_MS = 24 * 3600 * 1000;

export class SeriesBrowser {
  constructor(fetchImpl) {
    this._fetch = fetchImpl || function (u) { return fetch(u); };
  }

  /** @returns {Promise<payload>} saisons normalisées ; cache d'abord, panneau ensuite. */
  async ensureInfo(playlist, series) {
    if (!playlist || playlist.source !== 'xtream') throw new Error('SERIES_XTREAM_ONLY');
    const now = Date.now();
    const cached = await db.series_info.get(series.id);
    if (cached && cached.payload && (now - cached.fetchedAt) < INFO_TTL_MS) return cached.payload;

    const url = XtreamClient.seriesInfoUrl(playlist.base, playlist.username,
                                           playlist.password, series.seriesId);
    let res;
    try {
      res = await this._fetch(url);
    } catch (eNet) {
      throw new Error('SERIES_INFO_UNAVAILABLE');
    }
    if (!res.ok) throw new Error('SERIES_INFO_HTTP_' + res.status);
    let json;
    try { json = await res.json(); }
    catch (eJson) { throw new Error('SERIES_INFO_INVALID'); }

    const payload = SeriesBrowser.normalize(json);
    try {
      await db.series_info.put({ id: series.id, importId: series.importId,
                                playlistId: playlist.id, payload: payload, fetchedAt: now });
    } catch (eDb) { /* cache best effort : détail rendu quand même */ }
    return payload;
  }

  // Deux formes de panneaux : { seasons: { idx: { name, episodes: { n: [ep…] } } } }
  // ou { entries: { n: [ep…] } | [ep…] } (aplati → une saison synthétique).
  static normalize(json) {
    const info = (json && json.info) || {};
    const out = {
      title: String(info.name || ''),
      cover: String(info.cover || ''),
      plot: String(info.plot || ''),
      rating: info.rating == null ? '' : String(info.rating),
      seasons: []
    };
    const mkEp = function (e) {
      return {
        id: String(e.id != null ? e.id : (e.episode_id || '')),
        episodeId: e.episode_id == null ? '' : String(e.episode_id),
        title: String(e.title || ('Épisode ' + (e.episode_id != null ? e.episode_id : ''))),
        ext: String(e.container_extension || 'mp4'),
        plot: String(e.plot || '')
      };
    };
    const collect = function (epsRaw) {
      const eps = [];
      const pushList = function (arr) {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] && typeof arr[i] === 'object') eps.push(mkEp(arr[i]));
        }
      };
      if (Array.isArray(epsRaw)) pushList(epsRaw);
      else if (epsRaw && typeof epsRaw === 'object') Object.keys(epsRaw).forEach(function (k) { pushList(epsRaw[k]); });
      eps.sort(function (a, b) {
        const na = parseFloat(a.episodeId), nb = parseFloat(b.episodeId);
        return (isNaN(na) ? 0 : na) - (isNaN(nb) ? 0 : nb);
      });
      return eps;
    };
    if (json && json.seasons && typeof json.seasons === 'object') {
      const keys = Object.keys(json.seasons).map(Number).filter(function (n) { return !isNaN(n); });
      keys.sort(function (a, b) { return a - b; });
      for (let k = 0; k < keys.length; k++) {
        const sn = json.seasons[String(keys[k])] || json.seasons[keys[k]] || {};
        const eps = collect(sn.episodes);
        if (eps.length === 0) continue;
        out.seasons.push({ number: keys[k] + 1,
                           name: String(sn.name || ('Saison ' + (keys[k] + 1))),
                           episodes: eps });
      }
    } else if (json && (json.entries || Array.isArray(json.episodes))) {
      const eps = collect(json.entries || json.episodes);
      if (eps.length > 0) out.seasons.push({ number: 1, name: 'Épisodes', episodes: eps });
    }
    return out;
  }

  static episodeUrl(playlist, episode) {
    return XtreamClient.seriesStreamUrl(playlist.base, playlist.username, playlist.password,
                                        episode.id, episode.ext);
  }
}
