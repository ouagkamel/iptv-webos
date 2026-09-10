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
import { SeriesBrowser } from './services/SeriesBrowser.js';
import { CONFIG } from './config.js';

const state = {
  tab: 'playlists',
  playlists: [],
  activePlaylistId: null,
  items: { live: [], vod: [], series: [] },
  // V11 : filtre à catégories serveur par vue ('' = Toutes)
  catFilter: { live: '', vod: '', series: '' },
  selIndex: -1,
  provider: { maxConcurrentStreams: 0 },
  dualEligible: false,
  playerOpen: false
};

let ctx, engine, osd, videoEl, adapter, lifecycle, root;
let importBadge = null; // V10 : vignette de progression (non interactive, hors focus)
let seriesBrowser = null; // V11 : détail de série lazy (§6.6)
let seriesOverlay = null;
let seriesOverlayBack = null;
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

function handleListKeys(e) {
  if (state.tab !== 'live' && state.tab !== 'vod' && state.tab !== 'series') return;
  const kind = state.tab;
  const list = lists[kind];
  const total = list.items.length;
  if (total === 0) return;

  if (e.keyCode === 38 || e.keyCode === 40) {
    e.preventDefault(); e.stopImmediatePropagation();
    state.selIndex = (state.selIndex + (e.keyCode === 40 ? 1 : -1) + total) % total;
    scrollToShow(kind, state.selIndex);
    syncFocusables(kind);
  } else if (e.keyCode === 13) {
    e.preventDefault(); e.stopImmediatePropagation();
    const item = list.items[state.selIndex];
    if (item) activateChannel(kind, item);
  }
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

async function activateChannel(kind, item) {
  if (kind === 'series') { openSeriesDetail(item); return; } // §6.6 : la série se joue par épisode
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
async function openSeriesDetail(item) {
  closeSeriesDetail();
  const pl = await ctx.manager.get(state.activePlaylistId);
  seriesOverlayBack = closeSeriesDetail;
  engine.pushBackHandler(seriesOverlayBack);
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
  engine.setFocusables([closeB]);

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
  const focusEls = [closeB];
  const seasons = (payload && payload.seasons) || [];
  for (let s = 0; s < seasons.length; s++) {
    const sn = seasons[s];
    const h = el('div', 'sd-season');
    h.textContent = sn.name + '  ·  ' + sn.episodes.length + ' épisode(s)';
    body.appendChild(h);
    for (let e = 0; e < sn.episodes.length; e++) {
      const ep = sn.episodes[e];
      const b = el('button', 'sd-epi');
      b.tabIndex = 0;
      b.textContent = 'S' + pad2(sn.number) + 'E' + pad2(ep.episodeId) + '  ' + ep.title;
      (function (episode, season) {
        b.addEventListener('click', function () { playEpisode(pl, item, season, episode); });
      })(ep, sn);
      body.appendChild(b);
      focusEls.push(b);
    }
  }
  if (focusEls.length === 1) {
    const none = el('div', 'sd-error');
    none.textContent = 'Aucun épisode fourni par le panneau.';
    body.appendChild(none);
  }
  engine.setFocusables(focusEls);
}

function closeSeriesDetail() {
  if (!seriesOverlay) return;
  if (seriesOverlay.parentNode) seriesOverlay.parentNode.removeChild(seriesOverlay);
  seriesOverlay = null;
  if (seriesOverlayBack) { engine.removeBackHandler(seriesOverlayBack); seriesOverlayBack = null; }
  if (state.tab === 'series') syncFocusables('series');
  else renderTab();
}

function playEpisode(pl, series, season, ep) {
  closeSeriesDetail();
  openPlayer();
  adapter.play(SeriesBrowser.episodeUrl(pl, ep));
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
  window.addEventListener('keydown', function (e) {
    if (seriesOverlay && e.keyCode === 27) { // Échap : le détail prime sur tout (desktop/simulateur)
      e.preventDefault(); e.stopImmediatePropagation(); closeSeriesDetail();
    } else if (state.playerOpen && e.keyCode === 27) {
      e.preventDefault(); e.stopImmediatePropagation(); closePlayer();
    }
  });
  // Le handler de liste est enregistré AVANT engine.init() ? engine est déjà init ;
  // on place le nôtre sur window avec stopImmediatePropagation, donc il doit passer
  // en PREMIER : re-register ordre — on retire/réajoute le listener du moteur.
  window.removeEventListener('keydown', engine.boundOnKeyDown);
  window.addEventListener('keydown', handleListKeys);
  window.addEventListener('keydown', engine.boundOnKeyDown);

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
