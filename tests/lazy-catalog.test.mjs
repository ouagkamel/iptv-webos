// Régression statique V20 : app.js est un point d'entrée avec effets de boot
// (Worker ?worker, Dexie, DOM), donc le contrat d'orchestration lazy est vérifié
// sans démarrer une seconde application dans le harnais Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('V20 lazy catalogue : pas de Promise.all global, purge bornée et garde anti-réponse obsolète', () => {
  assert.doesNotMatch(source, /Promise\.all\(\s*\[\s*ctx\.manager\.channels/,
    'live/vod/series ne sont plus chargés simultanément');
  assert.match(source, /function clearCatalogMemory\(\)/);
  assert.match(source, /KIND_TO_MANAGER = \{ live: 'channels', vod: 'vod', series: 'series' \}/);
  assert.match(source, /state\.items\[kind\] = \[\]/);
  assert.match(source, /lists\[kind\]\.setItems\(\[\]\)/);
  assert.match(source, /token !== catalogLoadToken/,
    'un changement d’onglet ou de playlist invalide la réponse async');
  assert.match(source, /if \(detail\.kind === 'playlist'\) loadActiveData\(\)/,
    'un EPG terminé ne recharge pas un catalogue');
});
