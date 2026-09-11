// src/data/ImportProfiles.js — profils de test d'import V17.
// Un profil ne change pas le protocole : il choisit uniquement la taille des
// CHUNK, le type d'écriture IDB et la respiration entre deux lots. Les boutons
// UI servent à comparer ces variantes sur une vraie TV ; « standard » reste le
// réglage de production sûr.
export const IMPORT_PROFILES = [
  {
    id: 'standard',
    shortLabel: 'Test import 1',
    label: 'Test 1 — standard (2 000 / bulkPut)',
    chunkItems: 2000,
    writeMode: 'put',
    yieldMs: 32,
    parallelCatalogs: true
  },
  {
    id: 'put4000',
    shortLabel: 'Test import 2',
    label: 'Test 2 — lots 4 000 (bulkPut)',
    chunkItems: 4000,
    writeMode: 'put',
    yieldMs: 16,
    parallelCatalogs: true
  },
  {
    id: 'put8000',
    shortLabel: 'Test import 3',
    label: 'Test 3 — lots 8 000 (pause minimale)',
    chunkItems: 8000,
    writeMode: 'put',
    yieldMs: 0,
    parallelCatalogs: true
  },
  {
    id: 'add4000',
    shortLabel: 'Test import 4',
    label: 'Test 4 — lots 4 000 (bulkAdd)',
    chunkItems: 4000,
    writeMode: 'add',
    yieldMs: 8,
    parallelCatalogs: true
  },
  {
    id: 'sequential',
    shortLabel: 'Test import 5',
    label: 'Test 5 — catalogues séquentiels',
    chunkItems: 2000,
    writeMode: 'put',
    yieldMs: 32,
    parallelCatalogs: false
  }
];

export function importProfileById(id) {
  for (let i = 0; i < IMPORT_PROFILES.length; i++) {
    if (IMPORT_PROFILES[i].id === id) return IMPORT_PROFILES[i];
  }
  return IMPORT_PROFILES[0];
}
