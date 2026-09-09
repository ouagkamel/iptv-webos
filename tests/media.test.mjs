// tests/media.test.mjs — matrice §7.1 : passage unique NATIVE→MSE, budgets par
// moteur, 401/403 sans retry, requestId anti-race, anti timer-zombie, cycle de
// vie §7.4 (sauvegarde/restauration), watchdog one-shot, politique §7.5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers/dom.mjs';
import { __hlsInstances } from './helpers/hlsStub.mjs';
import { MediaAdapter } from '../src/media/MediaAdapter.js';
import { MediaWatchdog } from '../src/media/Watchdog.js';
import { LifecycleAdapter } from '../src/platform/LifecycleAdapter.js';
import { DualPlayerPolicy } from '../src/media/DualPlayerPolicy.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeVideo() {
  const { createElement } = makeDom();
  const v = createElement('video');
  v.play = function () { this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); };
  return v;
}

function freshAdapter() {
  __hlsInstances.length = 0;
  const v = makeVideo();
  const a = new MediaAdapter(v);
  a.init();
  return { a, v };
}

test('play() → LOADING/NATIVE ; playing → PLAYING (watchdog armé)', () => {
  const { a, v } = freshAdapter();
  const rid = a.play('http://x/live.m3u8');
  assert.equal(rid, 1);
  assert.equal(a.state, 'LOADING');
  assert.equal(a.engine, 'NATIVE');
  assert.ok(a.startupTimer, 'timeout startup armé');
  v.dispatch('playing');
  assert.equal(a.state, 'PLAYING');
  assert.equal(a.startupTimer, null, 'startup timeout soldé');
  assert.ok(a.watchdog.timer, 'watchdog armé');
  a.destroy();
});

test('LOADING + error natif → fallback HLS_MSE (passage unique), instance hls créée', () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('error');
  assert.equal(a.engine, 'HLS_MSE');
  assert.equal(__hlsInstances.length, 1);
  assert.equal(a.state, 'LOADING');
  // second error en LOADING côté MSE → ERROR (pas de second passage)
  v.dispatch('error');
  assert.equal(a.state, 'ERROR');
  a.destroy();
});

test('401/403 en HLS_MSE → ERROR immédiat, AUCUN retry (T4)', () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('error'); // → HLS_MSE
  const hls = __hlsInstances[0];
  let errEvent = null;
  window.addEventListener('media-error', function h(e) { errEvent = e.detail; });
  hls.emit('hlsError', { fatal: true, response: { code: 403 }, type: 'networkError' });
  assert.equal(a.state, 'ERROR');
  assert.ok(errEvent && /AUTHORIZATION_ERROR HTTP 403/.test(errEvent.message));
  assert.equal(hls.destroyed, true, 'pipeline détruit, aucun retry armé');
  assert.equal(a.recoveryTimer, null);
  a.destroy();
});

test('mediaError fatale MSE → recoverMediaError() max 1, compteur PARTAGÉ', () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('error');
  const hls = __hlsInstances[0];
  hls.emit('hlsError', { fatal: true, type: 'mediaError' });
  assert.equal(hls.recoverCalls, 1);
  assert.equal(a.recoveries, 1, 'jeton consommé par la récup média');
  // seconde mediaError : budget épuisé (partagé) → ni 2e recover, ni RECOVERING → ERROR
  hls.emit('hlsError', { fatal: true, type: 'mediaError' });
  assert.equal(hls.recoverCalls, 1);
  assert.equal(a.state, 'ERROR');
  a.destroy();
});

test('PLAYING + stall (watchdog) → RECOVERING ×1, échec → fallback MSE, ré-échec → ERROR', async () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('playing');
  assert.equal(a.state, 'PLAYING');

  a.handleStallTimeout(); // ce que le watchdog émet après 8 s
  assert.equal(a.state, 'RECOVERING');
  await sleep(1100); // le recoveryTimer planifie la reconnexion à +1 s

  // la reconnexion échoue (error en RECOVERING) → jeton NATIVE épuisé → fallback MSE
  v.dispatch('error');
  assert.equal(a.engine, 'HLS_MSE');
  assert.equal(a.recoveries, 0, 'budget frais par moteur');
  assert.equal(a.state, 'LOADING');

  a.handleStallTimeout(); // simulé en PLAYING seulement — on passe par error en PLAYING
  v.dispatch('playing');
  v.dispatch('error'); // PLAYING → _onPlaytimeFailure → RECOVERING (jeton MSE)
  assert.equal(a.state, 'RECOVERING');
  v.dispatch('error'); // échec de reconnexion MSE → ERROR (pas de retour NATIVE)
  assert.equal(a.state, 'ERROR');
  assert.equal(a.engine, 'HLS_MSE', 'jamais de retour MSE → NATIVE');
  a.destroy();
});

test('requestId anti-race : événements de l’ancienne session ignorés', () => {
  const { a, v } = freshAdapter();
  a.play('http://x/a.m3u8');
  v.dispatch('error');            // → MSE, instance hls1
  const hls1 = __hlsInstances[0];
  a.play('http://x/b.m3u8');      // nouvelle session : hls1 détruite, rid++
  const stateBefore = a.state;
  hls1.emit('hlsError', { fatal: true, response: { code: 500 }, type: 'networkError' });
  assert.equal(a.state, stateBefore, 'garde générationnelle : instance ≠ courante');
  a.destroy();
});

test('anti timer-zombie : re-plan de play() pendant la fenêtre RECOVERING annule le timer', async () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('playing');
  a.handleStallTimeout();
  assert.equal(a.state, 'RECOVERING');
  assert.ok(a.recoveryTimer, 'reconnexion planifiée à +1 s');
  a.play('http://x/other.m3u8'); // zapping pendant la fenêtre
  assert.equal(a.recoveryTimer, null, 'timer annulé par _teardownPlayback');
  const instancesBefore = __hlsInstances.length;
  await sleep(1100);
  assert.equal(__hlsInstances.length, instancesBefore, 'aucune action zombie du timer mort');
  a.destroy();
});

test('watchdog one-shot : 8 ticks sans progression → un seul tir ; progression → reset', () => {
  const realSetInterval = globalThis.setInterval;
  let captured = null;
  globalThis.setInterval = function (fn) { captured = fn; return { fake: true }; };
  try {
    const fakeAdapter = { currentRequestId: 1, videoEl: { paused: false, currentTime: 5, readyState: 0 } };
    let fired = 0;
    fakeAdapter.handleStallTimeout = function () { fired += 1; };
    const w = new MediaWatchdog(fakeAdapter);
    w.start(1);
    assert.ok(captured, 'tick armé');
    for (let i = 0; i < 10; i++) captured(); // currentTime figé, readyState < 3
    assert.equal(fired, 1, 'tir unique (pas de rafale)');
    // progression → reset
    fakeAdapter.videoEl.currentTime = 6; w.fired = false; w.stalledSeconds = 0;
    captured(); assert.equal(w.stalledSeconds, 0);
    w.stop();
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});

test('§7.4 LifecycleAdapter : hidden → releaseHardware + sauvegarde ; visible → reprise + seek VOD', async () => {
  const { a, v } = freshAdapter();
  const dom = makeDom();
  const prevDoc = globalThis.document;
  globalThis.document = dom.document;
  try {
    const lc = new LifecycleAdapter(a);
    lc.init();
    a.play('http://x/vod.mp4');
    v.dispatch('playing');
    v.currentTime = 120;
    assert.equal(a.state, 'PLAYING');

    dom.document.hidden = true;
    dom.document.dispatch('visibilitychange');
    assert.equal(a.state, 'IDLE', 'VPU libéré');
    assert.ok(lc.savedState, 'snapshot conservé');
    assert.equal(lc.savedState.position, 120);
    v.currentTime = 0; // le seek de reprise doit être la SEULE source du 120 final

    dom.document.hidden = false;
    dom.document.dispatch('visibilitychange');
    await sleep(10);
    assert.equal(a.state, 'LOADING', 'session rejouée');
    v.dispatch('playing');
    await sleep(10);
    assert.equal(v.currentTime, 120, 'reprise de position VOD (seekOnce)');
    lc.destroy();
    a.destroy();
  } finally {
    globalThis.document = prevDoc;
  }
});

test('§7.5 DualPlayerPolicy : triple porte + hover', () => {
  const cap6 = { isWebOS6OrHigher: true, modelName: 'OLED65G2UA' };
  const cap5 = { isWebOS6OrHigher: false, modelName: 'OLED65G2UA' };
  assert.equal(DualPlayerPolicy.isEligible(cap6, { maxConcurrentStreams: 2 }), true);
  assert.equal(DualPlayerPolicy.isEligible(cap6, { maxConcurrentStreams: 1 }), false);
  assert.equal(DualPlayerPolicy.isEligible(cap6, null), false);
  assert.equal(DualPlayerPolicy.isEligible(cap5, { maxConcurrentStreams: 4 }), false, 'webOS 5.0 jamais');
  assert.equal(DualPlayerPolicy.isEligible({ isWebOS6OrHigher: true, modelName: 'UNKNOWN99' },
                                            { maxConcurrentStreams: 8 }), false, 'modèle hors allowlist');
  assert.equal(DualPlayerPolicy.shouldActivate(799), false);
  assert.equal(DualPlayerPolicy.shouldActivate(800), true);
});

test('releaseHardware() : adapter réutilisable après veille (IDLE propre, src retiré)', () => {
  const { a, v } = freshAdapter();
  a.play('http://x/live.m3u8');
  v.dispatch('playing');
  a.releaseHardware();
  assert.equal(a.state, 'IDLE');
  assert.equal(a.engine, null);
  assert.equal(v.src, '', 'removeAttribute("src") appliqué');
  a.play('http://x/next.m3u8'); // réutilisable
  assert.equal(a.state, 'LOADING');
  assert.equal(a.currentRequestId, 2);
  a.destroy();
});
