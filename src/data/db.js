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
