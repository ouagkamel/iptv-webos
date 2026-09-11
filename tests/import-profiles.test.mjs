import assert from 'node:assert/strict';
import test from 'node:test';
import { IMPORT_PROFILES, importProfileById } from '../src/data/ImportProfiles.js';

test('V17 profils Xtream : cinq boutons et réglages exacts, lookup sûr', () => {
  assert.deepEqual(IMPORT_PROFILES.map((p) => p.shortLabel), [
    'Test import 1', 'Test import 2', 'Test import 3', 'Test import 4', 'Test import 5'
  ]);
  assert.deepEqual(IMPORT_PROFILES.map((p) => ({
    id: p.id, chunkItems: p.chunkItems, writeMode: p.writeMode,
    yieldMs: p.yieldMs, parallelCatalogs: p.parallelCatalogs
  })), [
    { id: 'standard', chunkItems: 2000, writeMode: 'put', yieldMs: 32, parallelCatalogs: true },
    { id: 'put4000', chunkItems: 4000, writeMode: 'put', yieldMs: 16, parallelCatalogs: true },
    { id: 'put8000', chunkItems: 8000, writeMode: 'put', yieldMs: 0, parallelCatalogs: true },
    { id: 'add4000', chunkItems: 4000, writeMode: 'add', yieldMs: 8, parallelCatalogs: true },
    { id: 'sequential', chunkItems: 2000, writeMode: 'put', yieldMs: 32, parallelCatalogs: false }
  ]);
  assert.equal(new Set(IMPORT_PROFILES.map((p) => p.id)).size, 5);
  assert.equal(importProfileById('unknown').id, 'standard');
  assert.equal(importProfileById('add4000').writeMode, 'add');
});
