// src/services/PlaylistManager.js — CRUD playlists, déclenchement d'imports,
// maintenance de boot (§5.5 : reprise sur crash + orphelins ; §5.6 : rétention EPG).
// Une playlist = UNE source (XP-2) : 'm3u' (m3uUrl [+ epgUrl]) OU 'xtream'
// (base/username/password — EPG via {base}/xmltv.php, pipeline §6 inchangé).
import { db } from '../data/db.js';
import { XtreamClient } from '../platform/XtreamClient.js';
import { orderRows } from './ListOrder.js';

const RUNNING_GRACE_MS = 5 * 60 * 1000; // §5.5 : import « running » récent non orphelin
const EPG_RETENTION_MS = 86400000;      // §5.6

export class PlaylistManager {
  /** @param pairs registre de paires { worker, dataManager, controller } par type,
   *  fourni par bootstrap.js — get(kind) recrée la paire après crash worker. */
  constructor(pairs) {
    this._pairs = pairs;
  }

  list() {
    return db.playlists.toArray();
  }

  get(playlistId) {
    return db.playlists.get(playlistId);
  }

  async ensureDefaultPlaylist(input) {
    const wanted = input || {};
    const base = XtreamClient.normalizeBase(wanted.base);
    const username = String(wanted.username || '').trim();
    const rows = await db.playlists.toArray();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].source === 'xtream' && rows[i].base === base && rows[i].username === username) {
        return rows[i].id;
      }
    }
    return this.create(Object.assign({}, wanted, { base: base, username: username }));
  }

  async create(input) {
    const name = String(input.name || 'Playlist').trim();
    const source = input.source === 'xtream' ? 'xtream' : 'm3u';
    const row = { name, source, updatedAt: Date.now() };

    if (source === 'xtream') {
      const base = XtreamClient.normalizeBase(input.base); // XTREAM_BASE_URL_INVALID si KO
      row.base = base;
      row.username = String(input.username || '').trim();
      row.password = String(input.password || '');
      row.epgUrl = XtreamClient.epgXmltvUrl(base, row.username, row.password);
      if (!row.username || !row.password) throw new Error('XTREAM_CREDENTIALS_MISSING');
    } else {
      row.m3uUrl = String(input.m3uUrl || '').trim();
      // http(s) pour le device ; blob: est accepté pour les fixtures des
      // harnais (smoke/harness) — aucune UI TV ne peut en saisir une.
      if (!/^(?:https?:\/\/|blob:)/i.test(row.m3uUrl)) throw new Error('M3U_URL_INVALID');
      row.epgUrl = String(input.epgUrl || '').trim() || null;
    }
    return db.playlists.add(row);
  }

  async remove(playlistId) {
    const importIds = await db.imports
      .where('playlistId').equals(playlistId).primaryKeys();
    if (importIds.length > 0) {
      await db.transaction('rw', [db.channels, db.epg, db.vod, db.series, db.series_info,
                                  db.categories, db.imports], async () => {
        await db.channels.where('importId').anyOf(importIds).delete();
        await db.vod.where('importId').anyOf(importIds).delete();
        await db.series.where('importId').anyOf(importIds).delete();
        await db.series_info.where('importId').anyOf(importIds).delete();
        await db.categories.where('importId').anyOf(importIds).delete();
        await db.epg.where('importId').anyOf(importIds).delete();
        await db.imports.bulkDelete(importIds);
      });
    }
    await db.playlists.delete(playlistId);
  }

  // Un échec de quota peut être survenu avant V17 : les lots déjà écrits de
  // l'import failed sont alors encore présents. Les supprimer avant un nouvel
  // essai ne touche jamais l'import actif (swap/integrity conservés).
  async _cleanupFailedImports(playlistId, kind) {
    const ids = await db.imports.where('playlistId').equals(playlistId)
      .and(function (row) { return row.kind === kind && row.status === 'failed'; })
      .primaryKeys();
    if (ids.length === 0) return;
    const tables = [db.channels, db.vod, db.series, db.series_info, db.categories, db.epg];
    const allTables = tables.concat([db.imports]);
    await db.transaction('rw', allTables, async () => {
      for (let i = 0; i < tables.length; i++) {
        await tables[i].where('importId').anyOf(ids).delete();
      }
      await db.imports.bulkDelete(ids);
    });
  }

  /** Import playlist (M3U ou Xtream) — même voie pour les deux sources (§6.5). */
  async importPlaylist(playlistId, options) {
    const pl = await db.playlists.get(playlistId);
    if (!pl) throw new Error('Playlist introuvable');
    const isXtream = pl.source === 'xtream';
    if (!isXtream && !pl.m3uUrl) throw new Error('M3U_URL_MISSING');

    await this._cleanupFailedImports(playlistId, 'playlist');
    const pair = this._pairs.get(isXtream ? 'xtream' : 'playlist');
    const importId = await db.imports.add({
      playlistId: playlistId, kind: 'playlist', status: 'running', createdAt: Date.now()
    });

    const job = isXtream
      ? { source: 'xtream', importId, playlistId, kind: 'playlist',
          base: pl.base, username: pl.username, password: pl.password,
          profile: options && options.profile ? options.profile : null }
      : { importId, playlistId, kind: 'playlist', url: pl.m3uUrl,
          profile: options && options.profile ? options.profile : null };

    return pair.controller.startImport(job).then(
      function (detail) { return detail; },
      function (err) { throw err; }
    );
  }

  async importEpg(playlistId) {
    const pl = await db.playlists.get(playlistId);
    if (!pl || !pl.epgUrl) throw new Error('EPG_URL_MISSING');
    await this._cleanupFailedImports(playlistId, 'epg');
    const pair = this._pairs.get('epg');
    const importId = await db.imports.add({
      playlistId: playlistId, kind: 'epg', status: 'running', createdAt: Date.now()
    });
    return pair.controller.startImport({ importId: importId, playlistId: playlistId,
                                         kind: 'epg', url: pl.epgUrl });
  }

  abort(playlistId, kind) {
    const pair = this._pairs.get(kind === 'epg' ? 'epg' : 'playlist');
    const importId = pair.controller.currentImportId;
    pair.controller.abort();
    // §9 « Abort en cours » : status 'failed' + pas de swap. Le write est de la
    // responsabilité applicative (le filet §5.5 le refait au boot si l'app meurt
    // avant) : on solde immédiatement et on retire les lignes partielles.
    if (importId != null) {
      db.imports.update(importId, { status: 'failed', error: 'annulé par l’utilisateur' })
        .catch(function (e) { console.error('marquage abort:', e); });
      db.transaction('rw', [db.channels, db.epg, db.vod, db.series, db.series_info, db.categories], function () {
        if (kind === 'epg') return db.epg.where('importId').equals(importId).delete();
        return Promise.all([
          db.channels.where('importId').equals(importId).delete(),
          db.vod.where('importId').equals(importId).delete(),
          db.series.where('importId').equals(importId).delete(),
          db.series_info.where('importId').equals(importId).delete(),
          db.categories.where('importId').equals(importId).delete()
        ]);
      }).catch(function (e) { console.error('purge partielle abort:', e); });
    }
  }

  channels(playlistId) { return this._ordered(playlistId, 'channels', 'live'); }
  vod(playlistId) { return this._ordered(playlistId, 'vod', 'vod'); }
  series(playlistId) { return this._ordered(playlistId, 'series', 'series'); }

  /** V13 §5.3 : lecture dans l'ordre du serveur (rang de catégorie, sortIdx). */
  async _ordered(playlistId, table, kind) {
    const pl = await db.playlists.get(playlistId);
    if (!pl || !pl.activeImportId) return [];
    const parts = await Promise.all([
      db[table].where('importId').equals(pl.activeImportId).toArray(),
      db.categories.where('[importId+kind]').equals([pl.activeImportId, kind]).sortBy('sort')
        .catch(function () { return []; }) // catégories absentes → tri par sortIdx seul
    ]);
    const catNames = (parts[1] || []).map(function (c) { return c.name; });
    return orderRows(parts[0], catNames);
  }

  /** Catégories serveur de l'import actif, dans l'ordre du serveur (V11, §6.4). */
  categories(playlistId, kind) {
    return db.playlists.get(playlistId).then(function (pl) {
      if (!pl || !pl.activeImportId) return [];
      return db.categories.where('[importId+kind]').equals([pl.activeImportId, kind])
        .sortBy('sort');
    });
  }

  /**
   * §5.5 — Reprise sur crash au boot :
   *  1. imports « running » (tués avec l'app) → 'failed' ;
   *  2. orphelins : lignes channels/epg/vod dont l'importId n'est ni référencé
   *     actif, ni porté par un import running récent (< 5 min) → purge anyOf.
   * §5.6 — rétention EPG : stopTime < now − 24 h → delete.
   */
  async bootMaintenance() {
    const now = Date.now();
    await db.transaction('rw', [db.playlists, db.imports, db.channels, db.epg, db.vod,
                                db.series, db.series_info, db.categories], async () => {
      const running = await db.imports.where('status').equals('running').toArray();
      const freshRunning = {};
      const stale = [];
      for (let i = 0; i < running.length; i++) {
        if (now - (running[i].createdAt || 0) < RUNNING_GRACE_MS) {
          freshRunning[running[i].kind] = freshRunning[running[i].kind] || new Set();
          freshRunning[running[i].kind].add(running[i].id);
        } else {
          stale.push(running[i].id);
        }
      }
      for (let s = 0; s < stale.length; s++) {
        await db.imports.update(stale[s], { status: 'failed', error: 'crash ou kill pendant import' });
      }

      const playlists = await db.playlists.toArray();
      const activePlaylistIds = new Set(); // protège channels + vod
      const activeEpgIds = new Set();
      for (let p = 0; p < playlists.length; p++) {
        if (playlists[p].activeImportId != null) activePlaylistIds.add(playlists[p].activeImportId);
        if (playlists[p].activeEpgImportId != null) activeEpgIds.add(playlists[p].activeEpgImportId);
      }

      await this._purgeOrphans(db.channels, activePlaylistIds,
                               freshRunning.playlist || new Set());
      await this._purgeOrphans(db.vod, activePlaylistIds,
                               freshRunning.playlist || new Set());
      await this._purgeOrphans(db.series, activePlaylistIds,
                               freshRunning.playlist || new Set());
      await this._purgeOrphans(db.series_info, activePlaylistIds,
                               freshRunning.playlist || new Set());
      await this._purgeOrphans(db.categories, activePlaylistIds,
                               freshRunning.playlist || new Set());
      await this._purgeOrphans(db.epg, activeEpgIds,
                               freshRunning.epg || new Set());
    });

    // §5.6 — purge d'expiration (index stopTime seul, règle DB-2)
    await db.epg.where('stopTime').below(now - EPG_RETENTION_MS).delete();
  }

  async _purgeOrphans(table, activeIds, freshRunningIds) {
    const seen = await table.orderBy('importId').uniqueKeys();
    const orphans = [];
    for (let k = 0; k < seen.length; k++) {
      const impId = seen[k];
      if (impId == null) continue;
      if (activeIds.has(impId) || freshRunningIds.has(impId)) continue;
      orphans.push(impId);
    }
    if (orphans.length > 0) {
      await table.where('importId').anyOf(orphans).delete();
    }
  }
}
