// src/app.js — UI minimale fonctionnelle (Sprint 3 du plan) : onglets
// Playlistes / Chaînes (live) / Films (VOD Xtream), imports M3U+EPG+Xtream,
// D-Pad via FocusEngine (moteur verbatim ; guidage fenêtre du VirtualList
// pris en charge ici — l'invariant §1.2-6 est garanti par le composant),
// PlayerOSD, DualPlayerPolicy (portes §7.5, désactivée par défaut).
import { boot } from './bootstrap.js';
import { FocusEngine } from './ui/FocusEngine.js';
import { VirtualList } from './ui/VirtualList.js';
import { MediaAdapter } from './media/MediaAdapter.js';
import { LifecycleAdapter } from './platform/LifecycleAdapter.js';
import { DualPlayerPolicy } from './media/DualPlayerPolicy.js';
import { PlayerOSD } from './components/PlayerOSD.js';
import { ImportBadge } from './components/ImportBadge.js';
import { classifyKey, createRepeatGate, stepIndex, pageIndex } from './ui/RemoteKeys.js';
import { SeriesBrowser } from './services/SeriesBrowser.js';
import { CONFIG, DEFAULT_PLAYLIST } from './config.js';

const state = {
  tab: 'playlists',
  playlists: [],
  activePlaylistId: null,
  items: { live: [], vod: [], series: [] },
  // V11 : filtre à catégories serveur par vue ('' = Toutes)
  catFilter: { live: '', vod: '', series: '' },
  selIndex: -1,
  provider: { maxConcurrentStreams: 0 },
  // V12 §8.4 : contexte de lecture en cours (zap ↑/↓ dans le lecteur)
  playing: null,
  dualEligible: false,
  playerOpen: false
};

let ctx, engine, osd, videoEl, adapter, lifecycle, root;
let importBadge = null; // V10 : vignette de progression (non interactive, hors focus)
let seriesBrowser = null; // V11 : détail de série lazy (§6.6)
let seriesOverlay = null;
let seriesCtx = null;   // { pl, item, payload, level:'seasons'|'episodes', seasonIdx }
let seriesRefs = null;  // nœuds stables de l'overlay (body, closeB)
let seriesBack = null;  // handler courant de la pile LIFO du panneau
const lists = {};
const catSelects = {};

async function main() {
  root = document.getElementById('root');
  ctx = await boot();
  engine = new FocusEngine();
  osd = null; // posé après construction du lecteur

  buildLayout();
  importBadge = new ImportBadge(document.body);
  seriesBrowser = new SeriesBrowser();
  engine.init();
  wireGlobalEvents();

  const defaultPlaylistId = await ctx.manager.ensureDefaultPlaylist(DEFAULT_PLAYLIST);
  if (state.activePlaylistId === null && defaultPlaylistId != null) {
    state.activePlaylistId = defaultPlaylistId;
  }
  await refreshPlaylists();
  renderTab();
  const step = document.getElementById('boot-step');
  if (step && step.parentNode) step.parentNode.removeChild(step);
  console.log('[app] prêt');
}

/* ——————————————————— layout ——————————————————— */

function buildLayout() {
  root.innerHTML = '';

  const header = el('header', 'hdr');
  header.appendChild(tabButton('playlists', 'Playlistes'));
  header.appendChild(tabButton('live', 'Chaînes'));
  header.appendChild(tabButton('vod', 'Films'));
  header.appendChild(tabButton('series', 'Séries'));
  root.appendChild(header);

  const body = el('div', 'body');
  state.views = {
    playlists: buildPlaylistsView(),
    live: buildListView('live'),
    vod: buildListView('vod'),
    series: buildListView('series')
  };
  body.appendChild(state.views.playlists);
  body.appendChild(state.views.live);
  body.appendChild(state.views.vod);
  body.appendChild(state.views.series);
  root.appendChild(body);
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function tabButton(tab, label) {
  const b = el('button', 'tab-btn');
  b.textContent = label;
  b.tabIndex = 0;
  b.addEventListener('click', function () { state.tab = tab; renderTab(); });
  return b;
}

function buildPlaylistsView() {
  const view = el('div', 'view view-playlists');

  const form = el('div', 'pl-form');
  const nameI = input('Nom', 'text'); form.appendChild(field('Nom', nameI));
  const srcS = el('select'); srcS.tabIndex = 0;
  [['m3u', 'M3U (URL)'], ['xtream', 'Xtream (URL+identifiants)']].forEach(function (o) {
    const op = el('option'); op.value = o[0]; op.textContent = o[1]; srcS.appendChild(op);
  });
  form.appendChild(field('Source', srcS));
  const m3uI = input('URL .m3u', 'text'); form.appendChild(field('URL playlist', m3uI));
  const epgI = input('URL xmltv (optionnel)', 'text'); form.appendChild(field('URL EPG', epgI));
  const baseI = input('https://panel:port', 'text'); form.appendChild(field('Base Xtream', baseI));
  const userI = input('username', 'text'); form.appendChild(field('Utilisateur', userI));
  const passI = input('password', 'password'); form.appendChild(field('Mot de passe', passI));
  // XP-3 : jamais de journalisation des credentials (mot de passe jamais lu dans un log)
  const save = button('Enregistrer la playlist', async function () {
    try {
      await ctx.manager.create({
        name: nameI.value, source: srcS.value, m3uUrl: m3uI.value, epgUrl: epgI.value,
        base: baseI.value, username: userI.value, password: passI.value
      });
      osd && osd.setStatus('Playlist enregistrée');
      await refreshPlaylists(); renderTab();
    } catch (err) { osd && osd.setStatus('Refus : ' + err.message); }
  });
  form.appendChild(save);
  view.appendChild(form);

  state.plListEl = el('div', 'pl-list');
  view.appendChild(state.plListEl);
  return view;
}

function input(ph, type) { const i = el('input'); i.tabIndex = 0; i.placeholder = ph; i.type = type || 'text'; return i; }
function field(label, node) { const w = el('label', 'field'); w.appendChild(el('span', 'lbl')); w.firstChild.textContent = label; w.appendChild(node); return w; }
function button(label, onClick) {
  const b = el('button', 'act-btn'); b.textContent = label; b.tabIndex = 0;
  b.addEventListener('click', onClick); return b;
}

function buildListView(kind) {
  const view = el('div', 'view view-list');
  const left = el('div', 'list-pane');
  const tools = el('div', 'tools');
  // V11 : catégories telles que définies par le serveur (ordre serveur conservé).
  const catS = el('select'); catS.tabIndex = 0;
  catS.addEventListener('change', function () {
    state.catFilter[kind] = catS.value || '';
    applySearch(kind, searchI.value);
  });
  catSelects[kind] = catS;
  tools.appendChild(catS);
  const searchI = input('Recherche (début de nom)…', 'text'); tools.appendChild(searchI);
  tools.appendChild(button('Chercher', function () { applySearch(kind, searchI.value); }));
  tools.appendChild(button('Tout', function () { searchI.value = ''; applySearch(kind, ''); }));
  left.appendChild(tools);

  const scroller = el('div', 'scroller');
  left.appendChild(scroller);
  view.appendChild(left);
  // V12 §8.4 : le curseur de la Magic Remote active désormais les lignes (pas
  // seulement les boutons) — délégation au niveau du scroller, les nœuds sont
  // recyclés par le VirtualList, jamais de listener par ligne.
  scroller.addEventListener('click', function (ev) {
    let t = ev.target;
    while (t && t !== scroller && !(t.getAttribute && t.getAttribute('data-index') !== null)) t = t.parentNode;
    if (!t || t === scroller) return;
    const idx = parseInt(t.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;
    state.selIndex = idx;
    const item = lists[kind].items[idx];
    if (item) { syncFocusables(kind); activateChannel(kind, item, idx); }
  });

  // (Le lecteur n'est plus enfoncé dans la vue live : voir ensurePlayer/openPlayer —
  //  vue-agnostic, overlay plein écran partagé live + VOD.)

  lists[kind] = new VirtualList(scroller, { itemHeight: 60, overscan: 4 });
  lists[kind].mount();
  return view;
}

/* ——————————————————— playlists ——————————————————— */

async function refreshPlaylists() {
  state.playlists = await ctx.manager.list();
  if (state.activePlaylistId === null && state.playlists.length > 0) {
    state.activePlaylistId = state.playlists[0].id;
  }
  const host = state.plListEl;
  host.innerHTML = '';
  state.playlists.forEach(function (pl) {
    const row = el('div', 'pl-row'); row.tabIndex = -1;
    row.textContent = pl.name + '  [' + (pl.source === 'xtream' ? 'Xtream' : 'M3U') + ']' +
      (pl.activeImportId ? '  ✓ importée' : '');
    const mk = function (label, fn) {
      const b = el('button', 'mini'); b.textContent = label; b.tabIndex = 0;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
      row.appendChild(b);
    };
    const sel = function () { state.activePlaylistId = pl.id; osd && osd.setStatus('Playlist active : ' + pl.name); loadActiveData(); };
    mk('Activer', sel);
    mk('Importer', function () { runImport(pl.id, false); });
    mk('EPG', function () { runImport(pl.id, true); });
    mk('Annuler', function () { ctx.manager.abort(pl.id, 'epg'); ctx.manager.abort(pl.id, 'playlist'); });
    mk('Supprimer', async function () {
      await ctx.manager.remove(pl.id);
      if (state.activePlaylistId === pl.id) state.activePlaylistId = null;
      await refreshPlaylists(); renderTab();
    });
    host.appendChild(row);
  });
}

async function runImport(playlistId, isEpg) {
  try {
    osd && osd.setStatus(isEpg ? 'Import EPG…' : 'Import playlist…');
    const p = isEpg ? ctx.manager.importEpg(playlistId) : ctx.manager.importPlaylist(playlistId);
    await p;
  } catch (err) {
    osd && osd.setStatus('Import : ' + err.message);
  }
}

async function loadActiveData() {
  if (state.activePlaylistId == null) return;
  const [live, vod, series] = await Promise.all([
    ctx.manager.channels(state.activePlaylistId),
    ctx.manager.vod(state.activePlaylistId),
    ctx.manager.series(state.activePlaylistId)
  ]);
  state.items.live = live;
  state.items.vod = vod;
  state.items.series = series;
  await Promise.all([refreshCategorySelectors('live'), refreshCategorySelectors('vod'),
                     refreshCategorySelectors('series')]);
  applySearch('live', '');
  applySearch('vod', '');
  applySearch('series', '');
}

const KIND_TO_CAT = { live: 'live', vod: 'vod', series: 'series' };
async function refreshCategorySelectors(kind) {
  const sel = catSelects[kind];
  if (!sel) return;
  let catNames = [];
  try {
    const rows = await ctx.manager.categories(state.activePlaylistId, KIND_TO_CAT[kind]);
    catNames = rows.map(function (r) { return r.name; });
  } catch (err) { catNames = []; }
  const catSet = new Set(catNames);
  const extra = [];
  if (catNames.length > 0) {
    const rows = state.items[kind] || [];
    for (let i = 0; i < rows.length; i++) {
      const g = String(rows[i].groupName || 'Autres');
      if (!catSet.has(g)) { catSet.add(g); extra.push(g); }
    }
  }
  const opts = [''].concat(catNames).concat(extra);
  const cur = state.catFilter[kind] || '';
  sel.innerHTML = '';
  for (let i = 0; i < opts.length; i++) {
    const op = el('option');
    op.value = opts[i];
    op.textContent = opts[i] === '' ? 'Toutes les catégories' : opts[i];
    sel.appendChild(op);
  }
  sel.value = opts.indexOf(cur) !== -1 ? cur : '';
  state.catFilter[kind] = sel.value;
  if (opts.indexOf(cur) === -1) state.catFilter[kind] = '';
}

function applySearch(kind, rawQuery) {
  const norm = String(rawQuery || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let all = state.items[kind] || [];
  const cat = state.catFilter[kind] || '';
  if (cat) all = all.filter(function (r) { return String(r.groupName || 'Autres') === cat; });
  const rows = !norm ? all : all.filter(function (r) {
    return String(r.searchName || '').indexOf(norm) === 0;
  }).slice(0, CONFIG.SEARCH_LIMIT);
  if (lists && lists[kind]) {
    lists[kind].setItems(rows);
    state.selIndex = rows.length ? 0 : -1;
    lists[kind].container.scrollTop = 0;
    lists[kind]._renderWindow();
    syncFocusables(kind);
  }
}

/* ——————————————————— focus / D-Pad ——————————————————— */

function visibleSlice(kind) {
  const list = lists[kind];
  const scrollTop = list.container.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / list.itemHeight) - list.overscan);
  const out = [];
  for (let k = 0; k < list.pool.length; k++) {
    const row = list.pool[k];
    const idx = row.getAttribute('data-index');
    if (row.style.display !== 'none' && idx !== null && parseInt(idx, 10) >= start) out.push(row);
  }
  return { rows: out, start: start };
}

function syncFocusables(kind) {
  const vis = visibleSlice(kind);
  engine.setFocusables(vis.rows);
  engine.currentIndex = vis.rows.length === 0 ? -1
    : Math.max(0, Math.min(vis.rows.length - 1, state.selIndex - vis.start));
}

/* ————————————— V12 §8.4 : routeur télécommande unifié —————————————
   Un seul handler, contextuel (lecteur ouvert / panneau série / liste / champ
   en cours d'édition), branché sur la table pure RemoteKeys. Enregistre AVANT
   le FocusEngine : les touches consommées stoppent la propagation, les autres
   (dont OK sur les boutons des overlays) passent au moteur. */
const moveGate = createRepeatGate(null, 45, 130);
const LIST_TABS = { live: true, vod: true, series: true };

function handleRemoteKey(e) {
  const t = e.target;
  const tag = (t && t.tagName) || '';
  const ctx = {
    inPlayer: !!state.playerOpen,
    inSeriesOverlay: !!seriesOverlay,
    seriesLevel: seriesCtx ? seriesCtx.level : null,
    editing: tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT',
    editKind: (tag === 'INPUT' || tag === 'TEXTAREA') ? 'input' : null,
    tab: state.tab
  };
  const action = classifyKey(e.keyCode, ctx);
  if (!action) return;

  if (action === 'form-enter') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (LIST_TABS[state.tab] && t) applySearch(state.tab, t.value);
    return;
  }
  if (action === 'osd') { if (osd && typeof osd.reveal === 'function') osd.reveal(); return; }
  if (action === 'home') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (seriesOverlay) closeSeriesDetail();
    if (state.playerOpen) closePlayer();
    state.tab = 'playlists';
    renderTab();
    return;
  }
  if (action === 'series-back') { e.preventDefault(); e.stopImmediatePropagation(); engine.handleSystemBack(); return; }
  if (action === 'series-step-back') { e.preventDefault(); e.stopImmediatePropagation(); enterSeriesSeasons(); return; }
  if (action === 'playpause') { e.preventDefault(); e.stopImmediatePropagation(); togglePlayPause(); return; }
  if (action === 'seek-back' || action === 'seek-fwd') {
    e.preventDefault(); e.stopImmediatePropagation();
    nudgeSeconds(action === 'seek-fwd' ? 10 : -10);
    return;
  }
  if (action === 'close-player') { e.preventDefault(); e.stopImmediatePropagation(); closePlayer(); return; }
  if (action === 'zap-next' || action === 'zap-prev') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!moveGate(action)) return;
    zapInPlayer(action === 'zap-next' ? 1 : -1);
    return;
  }
  const kind = state.tab;
  if (!LIST_TABS[kind]) return;
  const list = lists[kind];
  if (!list || !list.items || list.items.length === 0) return;
  if (action === 'row-next' || action === 'row-prev') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!moveGate(action)) return;
    state.selIndex = stepIndex(list.items.length, state.selIndex, action === 'row-next' ? 1 : -1);
    scrollToShow(kind, state.selIndex);
    syncFocusables(kind);
  } else if (action === 'page-next' || action === 'page-prev') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!moveGate(action)) return;
    const per = Math.max(1, Math.floor((list.container.clientHeight || 720) / (list.itemHeight || 60)));
    state.selIndex = pageIndex(list.items.length, state.selIndex, action === 'page-next' ? per : -per);
    scrollToShow(kind, state.selIndex);
    syncFocusables(kind);
  } else if (action === 'activate') {
    e.preventDefault(); e.stopImmediatePropagation();
    const item = list.items[state.selIndex];
    if (item) activateChannel(kind, item, state.selIndex);
  }
}

function zapInPlayer(delta) {
  const p = state.playing;
  if (!p) return;
  if (p.kind === 'episode') { // dans un épisode : ↑/↓ = épisode précédent/suivant de la saison
    const ni = stepIndex(p.episodes.length, p.epIndex, delta);
    if (ni < 0) return;
    playEpisode(p.pl, p.series, p.season, p.episodes[ni], ni);
    return;
  }
  const list = lists[p.kind];
  if (!list) return;
  const ni = stepIndex(list.items.length, p.index, delta);
  if (ni < 0) return;
  state.selIndex = ni;
  playFromList(p.kind, ni);
}

function playFromList(kind, idx) {
  const item = lists[kind].items[idx];
  if (item) activateChannel(kind, item, idx);
}

function togglePlayPause() {
  if (!videoEl) return;
  try {
    if (videoEl.paused) {
      const pr = videoEl.play();
      if (pr && typeof pr.catch === 'function') pr.catch(function () { /* autoplay bloqué hors gesture : rien à signaler */ });
    } else {
      videoEl.pause();
    }
  } catch (eTP) { /* états transitoires du lecteur */ }
}

function nudgeSeconds(sec) {
  if (!videoEl || !state.playing || state.playing.kind === 'live') return; // le direct ne s'indexe pas
  try {
    const d = videoEl.duration;
    if (typeof d === 'number' && isFinite(d) && d > 0) {
      videoEl.currentTime = Math.max(0, Math.min(d - 0.5, (videoEl.currentTime || 0) + sec));
      if (osd) osd.setStatus((sec > 0 ? '+' : '') + sec + ' s');
    }
  } catch (eNS) { /* seek refusé par le flux : ignoré */ }
}

function scrollToShow(kind, idx) {
  const list = lists[kind];
  const vh = list.container.clientHeight || 720;
  const top = idx * list.itemHeight;
  if (top < list.container.scrollTop) {
    list.container.scrollTop = top;
  } else if (top + list.itemHeight > list.container.scrollTop + vh) {
    list.container.scrollTop = top + list.itemHeight - vh;
  }
  list._renderWindow();
}

async function activateChannel(kind, item, idx) {
  if (kind === 'series') { openSeriesDetail(item); return; } // §6.6 : la série se joue par épisode
  state.playing = { kind: kind, index: idx != null ? idx : state.selIndex };
  openPlayer();
  adapter.play(item.streamUrl);
  if (kind === 'live') {
    osd.setChannel(item.name);
    await showEpgFor(item);
  } else {
    osd.setStatus('VOD : ' + item.name); // lecture VOD = flux direct natif
  }
}

/* ——————————————————— lecteur overlay (correction revue device) ———————————————————
   Avant : le stage (video+OSD+adapter) n'existait que dans la vue 'live'. Conséquences
   VOD : un film lancé depuis l'onglet Films jouait dans le DOM caché de la vue live
   (écran noir silencieux), et pire, si la vue live n'avait jamais été construite,
   adapter était undefined → TypeError au Enter. Le lecteur est désormais un overlay
   plein écran créé à la demande, monté au-dessus des onglets pour live ET VOD ;
   fermeture par bouton, Échap (desktop) ou Back webOS 461 via la pile LIFO §8.1. */
let playerOverlay = null;
let playerStage = null;
let playerOpen = false;

function ensurePlayer() {
  if (adapter) return;
  playerStage = el('div', 'stage');
  videoEl = el('video', 'player');
  videoEl.setAttribute('playsinline', 'playsinline');
  playerStage.appendChild(videoEl);
  const closeB = el('button', 'mini close-player');
  closeB.textContent = 'Fermer';
  closeB.tabIndex = 0;
  closeB.addEventListener('click', closePlayer);
  playerStage.appendChild(closeB);
  osd = new PlayerOSD(playerStage);
  state.osdEl = playerStage;
  adapter = new MediaAdapter(videoEl);
  adapter.init();
  lifecycle = new LifecycleAdapter(adapter);
  lifecycle.init();
}

function openPlayer() {
  ensurePlayer();
  if (playerOpen) return;
  playerOpen = true;
  state.playerOpen = true;
  playerOverlay = el('div', 'player-overlay');
  playerOverlay.appendChild(playerStage);
  document.body.appendChild(playerOverlay);
  engine.setFocusables([playerStage.querySelector('.close-player')]);
  engine.pushBackHandler(closePlayer);
}

function closePlayer() {
  if (!playerOpen) return;
  playerOpen = false;
  state.playerOpen = false;
  state.playing = null;
  if (adapter) adapter.stop();
  if (playerOverlay && playerOverlay.parentNode) playerOverlay.parentNode.removeChild(playerOverlay);
  engine.removeBackHandler(closePlayer);
  if (state.tab === 'live' || state.tab === 'vod' || state.tab === 'series') syncFocusables(state.tab);
  else renderTab();
}

/* —————————————— détail de série (V11, §6.6) ——————————————
   Overlay plein écran dédié, même mécanique que le lecteur : back LIFO,
   focus borné, rendu XSS-safe. get_series_info est paresseux (cache 24 h) :
   un échec réseau affiche « Réessayer » sans jamais toucher à l'import. */
function pushSeriesBackHandler(fn) {
  if (seriesBack) engine.removeBackHandler(seriesBack);
  seriesBack = fn;
  engine.pushBackHandler(seriesBack);
}

async function openSeriesDetail(item) {
  closeSeriesDetail();
  const pl = await ctx.manager.get(state.activePlaylistId);
  seriesOverlay = el('div', 'series-detail');
  const head = el('div', 'sd-head');
  const closeB = el('button', 'mini close-sd');
  closeB.textContent = 'Fermer'; closeB.tabIndex = 0;
  closeB.addEventListener('click', closeSeriesDetail);
  const title = el('div', 'sd-title');
  title.textContent = item.name + (item.rating ? '  —  ★ ' + item.rating : '');
  const meta = el('div', 'sd-meta');
  meta.textContent = [item.groupName, item.releaseDate].filter(Boolean).join('  ·  ');
  const plot = el('div', 'sd-plot');
  plot.textContent = item.plot || '';
  head.appendChild(closeB); head.appendChild(title); head.appendChild(meta); head.appendChild(plot);
  const body = el('div', 'sd-body');
  seriesOverlay.appendChild(head);
  seriesOverlay.appendChild(body);
  document.body.appendChild(seriesOverlay);
  seriesRefs = { body: body, closeB: closeB };
  seriesCtx = { pl: pl, item: item, payload: null, level: null, seasonIdx: -1 };
  engine.setFocusables([closeB]);
  pushSeriesBackHandler(closeSeriesDetail);
  engine.currentIndex = 0;

  let payload;
  try {
    payload = await seriesBrowser.ensureInfo(pl, item);
  } catch (err) {
    const msg = el('div', 'sd-error');
    msg.textContent = 'Détail indisponible : ' + String((err && err.message) || err);
    const retry = el('button', 'mini');
    retry.textContent = 'Réessayer'; retry.tabIndex = 0;
    retry.addEventListener('click', function () { openSeriesDetail(item); });
    body.appendChild(msg); body.appendChild(retry);
    engine.setFocusables([closeB, retry]);
    return;
  }
  if (!payload || !payload.seasons || payload.seasons.length === 0) {
    const none = el('div', 'sd-error');
    none.textContent = 'Aucun épisode fourni par le panneau.';
    body.appendChild(none);
    return;
  }
  seriesCtx.payload = payload;
  // V12 §6.6 : sélection en deux temps (saison, puis épisode) ; une saison
  // unique va directement aux épisodes (pas de clic inutile).
  if (payload.seasons.length === 1) enterSeriesEpisodes(0, true);
  else enterSeriesSeasons();
}

function enterSeriesSeasons() {
  if (!seriesOverlay || !seriesCtx || !seriesRefs) return;
  seriesCtx.level = 'seasons';
  seriesCtx.seasonIdx = -1;
  const body = seriesRefs.body;
  body.innerHTML = '';
  const h = el('div', 'sd-h');
  h.textContent = 'Saisons';
  body.appendChild(h);
  const focusEls = [seriesRefs.closeB];
  const seasons = seriesCtx.payload.seasons;
  for (let i = 0; i < seasons.length; i++) {
    const sn = seasons[i];
    const b = el('button', 'sd-season-btn');
    b.tabIndex = 0;
    b.textContent = sn.name + '  —  ' + sn.episodes.length + ' épisode(s)';
    (function (idx) {
      b.addEventListener('click', function () { enterSeriesEpisodes(idx, false); });
    })(i);
    body.appendChild(b);
    focusEls.push(b);
  }
  engine.setFocusables(focusEls);
  pushSeriesBackHandler(closeSeriesDetail);
  engine.currentIndex = 0;
}

function enterSeriesEpisodes(seasonIdx, fromSingle) {
  if (!seriesOverlay || !seriesCtx || !seriesRefs) return;
  const sn = seriesCtx.payload.seasons[seasonIdx];
  if (!sn) return;
  seriesCtx.level = 'episodes';
  seriesCtx.seasonIdx = seasonIdx;
  const body = seriesRefs.body;
  body.innerHTML = '';
  const focusEls = [seriesRefs.closeB];
  if (!(fromSingle && seriesCtx.payload.seasons.length === 1)) {
    const backB = el('button', 'mini sd-back');
    backB.textContent = '← Toutes les saisons'; backB.tabIndex = 0;
    backB.addEventListener('click', enterSeriesSeasons);
    body.appendChild(backB);
    focusEls.push(backB);
  }
  const h = el('div', 'sd-h');
  h.textContent = sn.name + '  ·  ' + sn.episodes.length + ' épisode(s)';
  body.appendChild(h);
  for (let i = 0; i < sn.episodes.length; i++) {
    const ep = sn.episodes[i];
    const b = el('button', 'sd-epi');
    b.tabIndex = 0;
    b.textContent = 'S' + pad2(sn.number) + 'E' + pad2(ep.episodeId) + '  ' + ep.title;
    (function (episode, season, idx) {
      b.addEventListener('click', function () { playEpisode(seriesCtx.pl, seriesCtx.item, season, episode, idx); });
    })(ep, sn, i);
    body.appendChild(b);
    focusEls.push(b);
  }
  engine.setFocusables(focusEls);
  pushSeriesBackHandler(fromSingle ? closeSeriesDetail : enterSeriesSeasons);
  engine.currentIndex = 0;
}

function closeSeriesDetail() {
  if (!seriesOverlay) return;
  if (seriesOverlay.parentNode) seriesOverlay.parentNode.removeChild(seriesOverlay);
  seriesOverlay = null;
  seriesCtx = null;
  seriesRefs = null;
  if (seriesBack) { engine.removeBackHandler(seriesBack); seriesBack = null; }
  if (state.tab === 'series') syncFocusables('series');
  else renderTab();
}

function playEpisode(pl, series, season, ep, epIndex) {
  closeSeriesDetail();
  openPlayer();
  adapter.play(SeriesBrowser.episodeUrl(pl, ep));
  state.playing = { kind: 'episode', pl: pl, series: series, season: season,
                    episodes: season.episodes, epIndex: epIndex != null ? epIndex : 0 };
  osd.setChannel(series.name);
  osd.setStatus('S' + pad2(season.number) + 'E' + pad2(ep.episodeId) + ' — ' + ep.title);
}

function pad2(x) {
  const str = String(x == null ? '' : x);
  return str.length < 2 ? '0' + str : str;
}

async function showEpgFor(item) {
  if (!state.activePlaylistId || !item.channelId) { osd.setEpg('', ''); return; }
  const pl = await ctx.manager.get(state.activePlaylistId);
  if (!pl || !pl.activeEpgImportId || !pl.activeImportId) { osd.setEpg('', ''); return; }
  const now = Date.now();
  const imp = pl.activeImportId, ch = item.channelId;
  const cur = await ctx.db.epg
    .where('[importId+channelId+startTime]').between([imp, ch, now - 12 * 3600 * 1000], [imp, ch, now], true, true)
    .sortBy('startTime').then(function (a) { return a.length ? a[a.length - 1] : null; });
  const next = await ctx.db.epg
    .where('[importId+channelId+startTime]').between([imp, ch, now], [imp, ch, now + CONFIG.EPG_WINDOW_MS], false, true)
    .limit(1).toArray().then(function (a) { return a.length ? a[0] : null; });
  osd.setEpg(cur && cur.title, next && next.title);
}

/* ——————————————————— événements globaux ——————————————————— */

function wireGlobalEvents() {
  // Échap (desktop/simulateur) ferme l'overlay ; Back webOS (461) transite par la
  // pile LIFO du FocusEngine (handler poussé à l'ouverture, retiré à la fermeture).
  // Le handler de liste est enregistré AVANT engine.init() ? engine est déjà init ;
  // on place le nôtre sur window avec stopImmediatePropagation, donc il doit passer
  // en PREMIER : re-register ordre — on retire/réajoute le listener du moteur.
  window.removeEventListener('keydown', engine.boundOnKeyDown);
  window.addEventListener('keydown', handleRemoteKey);
  window.addEventListener('keydown', engine.boundOnKeyDown);
  // V12 : le OK du moteur (preventDefault + « focus-activate ») déclenche
  // désormais .click() sur l'élément focusé — corrige l'Entrée sur les boutons
  // des overlays et du formulaire (avant, elle ne déclenchait rien).
  window.addEventListener('focus-activate', function (e) {
    const el2 = e && e.detail && e.detail.element;
    if (el2 && typeof el2.click === 'function') el2.click();
  });

  window.addEventListener('import-complete', function () {
    osd && osd.setStatus('Import terminé');
    refreshPlaylists().then(loadActiveData);
  });
  window.addEventListener('import-error', function (e) {
    osd && osd.setStatus('Erreur import : ' + ((e.detail && e.detail.message) || 'inconnue'));
    refreshPlaylists();
  });
  window.addEventListener('import-aborted', function () {
    osd && osd.setStatus('Import annulé');
    refreshPlaylists();
  });
  window.addEventListener('media-error', function (e) {
    osd && osd.setStatus('Lecture : ' + ((e.detail && e.detail.message) || 'erreur'));
  });

  // §7.5 — branchement Xtream : max_connections du compte pilote la porte abonnement.
  window.addEventListener('xtream-account-info', function (e) {
    const d = e.detail || {};
    state.provider.maxConcurrentStreams = d.maxConnections || 0;
    state.dualEligible = DualPlayerPolicy.isEligible(ctx.capabilities, state.provider);
    console.log('[dual] eligible:', state.dualEligible); // activable + portes UI : v1.x
  });
}

function renderTab() {
  state.views.playlists.style.display = state.tab === 'playlists' ? '' : 'none';
  state.views.live.style.display = state.tab === 'live' ? '' : 'none';
  state.views.vod.style.display = state.tab === 'vod' ? '' : 'none';
  state.views.series.style.display = state.tab === 'series' ? '' : 'none';
  if (state.tab !== 'playlists') {
    applySearch(state.tab, '');
  } else {
    engine.setFocusables(Array.prototype.slice.call(
      state.views.playlists.querySelectorAll('button, input, select')));
  }
}

main().catch(function (err) {
  console.error('BOOT FAILURE:', err);
  // Fond forcé : lisible quel que soit le CSS appliqué (l'écran noir
  // « sans message » était le vrai défaut de cette branche sur device).
  document.documentElement.style.background = "#111";
  document.body.style.background = "#111";
  document.body.innerHTML = '<pre style="color:#fff;background:#111;padding:24px;font:18px/1.5 monospace;margin:0">Échec du démarrage : ' +
    String(err && err.message || err) + '</pre>';
});
