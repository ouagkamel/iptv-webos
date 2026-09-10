// src/services/SeriesBrowser.js — spec §6.6 (V11/V15). Détail des séries Xtream :
// LAZY (jamais à l'import) et cache local (db.series_info, TTL 24 h). Un appel
// réseau unitaire par série ouverte — hors protocole d'import §5.2 : petit JSON,
// pas de CHUNK, pas d'ack ; un échec n'affecte jamais l'import ni les autres vues.
import { db } from '../data/db.js';
import { XtreamClient } from '../platform/XtreamClient.js';

const INFO_TTL_MS = 24 * 3600 * 1000;
const INFO_FORMAT_VERSION = 2; // V15 : invalide les caches V11 sans forme episodes Xtream

export class SeriesBrowser {
  constructor(fetchImpl) {
    this._fetch = fetchImpl || function (u) { return fetch(u); };
  }

  /** @returns {Promise<payload>} saisons normalisées ; cache d'abord, panneau ensuite. */
  async ensureInfo(playlist, series) {
    if (!playlist || playlist.source !== 'xtream') throw new Error('SERIES_XTREAM_ONLY');
    const now = Date.now();
    const cached = await db.series_info.get(series.id);
    if (cached && cached.formatVersion === INFO_FORMAT_VERSION && cached.payload &&
        (now - cached.fetchedAt) < INFO_TTL_MS) return cached.payload;

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
                                playlistId: playlist.id, formatVersion: INFO_FORMAT_VERSION,
                                payload: payload, fetchedAt: now });
    } catch (eDb) { /* cache best effort : détail rendu quand même */ }
    return payload;
  }

  // Formes supportées : panneau legacy seasons, réponse Xtream réelle
  // { episodes: { "1": [ep…], "2": [ep…] } } avec episode_num, ou entries
  // aplati. Toutes sont normalisées vers seasons[].
  static normalize(json) {
    const info = (json && json.info) || {};
    const out = {
      title: String(info.name || ''),
      cover: String(info.cover || info.movie_image || ''),
      plot: String(info.plot || ''),
      rating: info.rating == null ? '' : String(info.rating),
      seasons: []
    };
    const mkEp = function (e) {
      const nested = e && e.info && typeof e.info === 'object' ? e.info : {};
      const rawId = e && e.id != null ? e.id : (e && e.episode_id != null ? e.episode_id : '');
      const rawNumber = e && e.episode_id != null ? e.episode_id
        : (e && e.episode_num != null ? e.episode_num
          : (e && e.episode != null ? e.episode : ''));
      return {
        id: String(rawId),
        episodeId: rawNumber === '' ? '' : String(rawNumber),
        title: String((e && e.title) || nested.name || ('Épisode ' + (rawNumber === '' ? '' : rawNumber))),
        ext: String((e && (e.container_extension || e.containerExtension)) || 'mp4'),
        plot: String((e && e.plot) || nested.plot || '')
      };
    };
    const looksLikeEpisode = function (v) {
      return v && typeof v === 'object' && !Array.isArray(v) &&
        (v.id != null || v.episode_id != null || v.episode_num != null || v.episode != null);
    };
    const collect = function (epsRaw) {
      const eps = [];
      const pushList = function (arr) {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
          if (looksLikeEpisode(arr[i])) eps.push(mkEp(arr[i]));
        }
      };
      if (Array.isArray(epsRaw)) {
        pushList(epsRaw);
      } else if (epsRaw && typeof epsRaw === 'object') {
        const keys = Object.keys(epsRaw);
        for (let i = 0; i < keys.length; i++) {
          const value = epsRaw[keys[i]];
          if (Array.isArray(value)) pushList(value);
          else if (looksLikeEpisode(value)) eps.push(mkEp(value));
        }
      }
      eps.sort(function (a, b) {
        const na = parseFloat(a.episodeId), nb = parseFloat(b.episodeId);
        const va = isNaN(na) ? Number.MAX_SAFE_INTEGER : na;
        const vb = isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb;
        if (va !== vb) return va - vb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      return eps;
    };
    const addSeason = function (number, name, epsRaw) {
      let n = Number(number);
      if (!isFinite(n) || n < 1) n = out.seasons.length + 1;
      const eps = collect(epsRaw);
      if (eps.length > 0) {
        out.seasons.push({ number: n, name: String(name || ('Saison ' + n)), episodes: eps });
      }
    };

    // Forme historique utilisée par certains panneaux : seasons dict 0-based
    // ou tableau portant season_num/number explicitement.
    if (json && Array.isArray(json.seasons)) {
      for (let i = 0; i < json.seasons.length; i++) {
        const sn = json.seasons[i] || {};
        const explicit = sn.season_num != null ? sn.season_num : (sn.number != null ? sn.number : i + 1);
        addSeason(explicit, sn.name, sn.episodes);
      }
    } else if (json && json.seasons && typeof json.seasons === 'object') {
      const keys = Object.keys(json.seasons).map(Number).filter(function (n) { return !isNaN(n); });
      keys.sort(function (a, b) { return a - b; });
      const zeroBased = keys.indexOf(0) !== -1;
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const sn = json.seasons[String(key)] || json.seasons[key] || {};
        const explicit = sn.season_num != null ? sn.season_num
          : (sn.number != null ? sn.number : (zeroBased ? key + 1 : key));
        addSeason(explicit, sn.name, sn.episodes);
      }
    }

    // Forme Xtream standard réelle : episodes est un dictionnaire
    // { "1": [episode…], "2": [episode…] }, episode_num porte le numéro
    // d'affichage et id porte l'identifiant du flux à lire.
    if (out.seasons.length === 0 && json && json.episodes && typeof json.episodes === 'object') {
      if (Array.isArray(json.episodes)) {
        addSeason(1, 'Saison 1', json.episodes);
      } else {
        const keys = Object.keys(json.episodes).map(Number).filter(function (n) { return !isNaN(n); });
        keys.sort(function (a, b) { return a - b; });
        for (let k = 0; k < keys.length; k++) {
          const seasonNumber = keys[k] < 1 ? 1 : keys[k];
          addSeason(seasonNumber, 'Saison ' + seasonNumber, json.episodes[String(keys[k])] || json.episodes[keys[k]]);
        }
      }
    }

    // Forme aplatie historique : entries, ou episodes tableau sans dictionnaire
    // de saisons, deviennent une saison synthétique.
    if (out.seasons.length === 0 && json && json.entries) {
      const eps = collect(json.entries);
      if (eps.length > 0) out.seasons.push({ number: 1, name: 'Épisodes', episodes: eps });
    }
    return out;
  }

  static episodeUrl(playlist, episode) {
    return XtreamClient.seriesStreamUrl(playlist.base, playlist.username, playlist.password,
                                        episode.id, episode.ext);
  }
}
