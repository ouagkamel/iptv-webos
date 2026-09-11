// src/data/ImportProfiles.js — réglage unique de production.
//
// L'interface ne propose plus de variantes de benchmark. Tous les imports
// utilisent ce profil : lots de 2 000 lignes, bulkAdd exclusivement, deux lots
// IndexedDB en vol et une respiration d'interface toutes les quatre écritures.
// Le champ writeMode est conservé comme information de protocole/documentation,
// mais DataManager impose bulkAdd même si un appel ancien fournit un autre mode.
export const DEFAULT_IMPORT_PROFILE = Object.freeze({
  id: 'default',
  label: 'Import par défaut — 2 000 / bulkAdd / 2 lots en vol',
  chunkItems: 2000,
  writeMode: 'add',
  parallelCatalogs: true,
  maxInFlightChunks: 2,
  yieldEveryChunks: 4
});

// Compatibilité source minimale pour les consommateurs qui importaient encore
// IMPORT_PROFILES : il n'existe désormais qu'un seul profil, sans boutons test.
export const IMPORT_PROFILES = Object.freeze([DEFAULT_IMPORT_PROFILE]);

export function importProfileById() {
  return DEFAULT_IMPORT_PROFILE;
}
