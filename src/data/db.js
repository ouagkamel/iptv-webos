// src/data/db.js — spec §5.1 (verbatim).
// v1 : playlists/imports/channels/epg. v2 (amendement V9) : table vod (DB-5),
// migration additive seule. Règles DB-1…DB-5 opposables.
import Dexie from 'dexie';

export const db = new Dexie('IPTVDatabase');

db.version(1).stores({
  playlists: '++id, name, activeImportId, activeEpgImportId, updatedAt',
  imports:   '++id, playlistId, kind, status, createdAt',
  channels:  'id, importId, [importId+groupName], channelId, searchName',
  epg:       'id, [importId+channelId+startTime], importId, stopTime'
});

// v2 (amendement Xtream, §6.5) : table VOD dédiée — migration additive seule,
// jamais de modification destructive des stores v1 (Dexie gère l'upgrade).
db.version(2).stores({
  vod: 'id, importId, [importId+groupName], searchName'
});

// v3 (révision V11, §6.6) : DB-6 — séries + cache paresseux + catégories serveur.
//   series      : une ligne par série (Xtream get_series ; le M3U n'en définit pas).
//   series_info : détail (saisons/épisodes) stocké LAZYLEMENT à la première
//                 ouverture (jamais à l'import), TTL 24 h, id = id de la série.
//   categories  : catégories telles que définies par le serveur (ordre conservé) ;
//                 M3U = group-title dans l'ordre de première apparition du fichier.
db.version(3).stores({
  series:      'id, importId, [importId+groupName], searchName',
  series_info: 'id, importId',
  categories:  '++cid, importId, [importId+kind]'
});

// v4 (V19) : régime d'index minimal pour réduire la write amplification sur les
// catalogues volumineux. L'UI charge déjà les lignes de l'import actif puis filtre,
// recherche et trie en JavaScript ; groupName, searchName et channelId ne sont
// donc pas des index de lecture nécessaires. La migration retire uniquement ces
// index secondaires et conserve les données, les clés primaires et importId.
db.version(4).stores({
  channels: 'id, importId',
  vod:      'id, importId',
  series:   'id, importId'
});
