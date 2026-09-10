// tests/remote-keys.test.mjs — V12 §8.4 : table de classement des touches
// (contexte lecteur / panneau série / liste / champ), zap et pagination
// circulaires, garde anti-répétition. Logique pure : aucun DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKey, stepIndex, pageIndex, createRepeatGate, KEY } from '../src/ui/RemoteKeys.js';

test('classifyKey : liste à onglet live/vod/series', () => {
  assert.equal(classifyKey(KEY.DOWN, { tab: 'live' }), 'row-next');
  assert.equal(classifyKey(KEY.UP, { tab: 'vod' }), 'row-prev');
  assert.equal(classifyKey(KEY.OK, { tab: 'series' }), 'activate');
  assert.equal(classifyKey(KEY.RIGHT, { tab: 'live' }), 'page-next');
  assert.equal(classifyKey(KEY.LEFT, { tab: 'live' }), 'page-prev');
  assert.equal(classifyKey(KEY.PAGE_DOWN, { tab: 'live' }), 'page-next');
  assert.equal(classifyKey(KEY.MEDIA_NEXT, { tab: 'live' }), 'activate');
  // onglet playlists : navigation native du moteur, rien à voler
  assert.equal(classifyKey(KEY.DOWN, { tab: 'playlists' }), null);
  assert.equal(classifyKey(KEY.BACK_ALT, { tab: 'live' }), null, 'back rendu au moteur (pile LIFO/platformBack)');
  assert.equal(classifyKey(KEY.HOME, { tab: 'vod' }), 'home');
});

test('classifyKey : dans le lecteur — zap, play/pause, stop, seek, info', () => {
  const inPlayer = { inPlayer: true, tab: 'live' };
  assert.equal(classifyKey(KEY.DOWN, inPlayer), 'zap-next');
  assert.equal(classifyKey(KEY.UP, inPlayer), 'zap-prev');
  assert.equal(classifyKey(KEY.MEDIA_NEXT, inPlayer), 'zap-next', 'PROG+');
  assert.equal(classifyKey(KEY.MEDIA_PREV, inPlayer), 'zap-prev', 'PROG-');
  assert.equal(classifyKey(KEY.MEDIA_PLAY_PAUSE, inPlayer), 'playpause');
  assert.equal(classifyKey(KEY.MEDIA_PAUSE, inPlayer), 'playpause');
  assert.equal(classifyKey(KEY.MEDIA_STOP, inPlayer), 'close-player');
  assert.equal(classifyKey(KEY.WEBOS_BACK, inPlayer), 'close-player');
  assert.equal(classifyKey(KEY.INFO, inPlayer), 'osd');
  // seek réservé aux flux indexables (vod/épisode)
  assert.equal(classifyKey(KEY.MEDIA_FF, { inPlayer: true, zappableSeek: true }), 'seek-fwd');
  assert.equal(classifyKey(KEY.MEDIA_REWIND, { inPlayer: true, zappableSeek: true }), 'seek-back');
  assert.equal(classifyKey(KEY.MEDIA_FF, { inPlayer: true, zappableSeek: false }), null, 'pas de seek en direct');
});

test('classifyKey : panneau série — OK natif, back et GAUCHE contextuels', () => {
  const eps = { inSeriesOverlay: true, seriesLevel: 'episodes' };
  assert.equal(classifyKey(KEY.LEFT, eps), 'series-step-back', '← = retour saisons');
  assert.equal(classifyKey(KEY.BACK_ALT, eps), 'series-back');
  assert.equal(classifyKey(KEY.WEBOS_BACK, eps), 'series-back');
  assert.equal(classifyKey(KEY.MEDIA_STOP, eps), 'series-back');
  assert.equal(classifyKey(KEY.OK, eps), null, 'OK = activation native du bouton focusé');
  assert.equal(classifyKey(KEY.DOWN, eps), null, 'flèches = navigation moteur');
  const seasons = { inSeriesOverlay: true, seriesLevel: 'seasons' };
  assert.equal(classifyKey(KEY.LEFT, seasons), null, 'pas de niveau au-dessus en saison : back fermera');
});

test('classifyKey : champs en édition ne sont jamais volés', () => {
  assert.equal(classifyKey(KEY.DOWN, { editing: true, editKind: 'input', tab: 'live' }), null);
  assert.equal(classifyKey(KEY.OK, { editing: true, editKind: 'input', tab: 'live' }), 'form-enter');
  assert.equal(classifyKey(KEY.OK, { editing: true, editKind: 'select', tab: 'vod' }), null, 'select natif');
});

test('stepIndex : circulaire, bornes et liste vide', () => {
  assert.equal(stepIndex(10, 4, 1), 5);
  assert.equal(stepIndex(10, 9, 1), 0, 'boucle en bas');
  assert.equal(stepIndex(10, 0, -1), 9, 'boucle en haut');
  assert.equal(stepIndex(10, -1, 1), 1, 'index négatif traité comme 0');
  assert.equal(stepIndex(1, 0, 1), 0, 'liste mono-ligne stable');
  assert.equal(stepIndex(0, 0, 1), -1, 'aucune ligne → action nulle');
});

test('pageIndex : page pleine, boucles en bas et en haut', () => {
  assert.equal(pageIndex(100, 50, 12), 62);
  assert.equal(pageIndex(100, 95, 12), 7, 'boucle circulaire en bas');
  assert.equal(pageIndex(100, 3, -12), 99, 'boucle circulaire en haut');
  assert.equal(pageIndex(0, 0, 12), -1);
  assert.equal(pageIndex(100, 10, 0), 11, 'page < 1 ligne → ±1');
});

test('createRepeatGate : anti-tempête de répétition (horloge injectée)', () => {
  let t = 1000;
  const gate = createRepeatGate(function () { return t; }, 45, 130);
  assert.equal(gate('row-next'), true, 'premier pas toujours accepté');
  t = 1020;
  assert.equal(gate('row-next'), false, 'répétition à 20 ms avalée (le TV répète à ~30 ms)');
  t = 1046;
  assert.equal(gate('row-next'), true, 'au-delà de 45 ms → passe');
  t = 1080;
  assert.equal(gate('zap-next'), true, 'zap indépendant du mouvement de liste');
  t = 1160;
  assert.equal(gate('zap-next'), false, 'zap limité à 130 ms (rechargement de flux coûteux)');
  t = 1211;
  assert.equal(gate('row-next'), true, 'mouvement de liste à nouveau permis');
  assert.equal(gate('zap-next'), true, 'zap : 1211−1080 = 131 ms ≥ 130 → passe (horloge par type)');
  t = 1250;
  assert.equal(gate('zap-next'), false, 'mais les compteurs sont indépendants par type');
});
