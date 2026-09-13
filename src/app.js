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
  tab: 'playlists', // profiles screen; selecting a profile opens the home dashboard
  playlists: [],
  favorites: [],
  activePlaylistId: null,
  items: { live: [], vod: [], series: [] },
  // V11 : filtre à catégories serveur par vue ('' = Toutes)
  catFilter: { live: '', vod: '', series: '' },
  guideCategory: '',
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
let profileModalBack = null;
let guideList = null;
let guideBack = null;
const lists = {};
const catSelects = {};
const CATALOG_KINDS = ['live', 'vod', 'series'];
let catalogLoadToken = 0;

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
  root.className = 'vision-shell';

  const sidebar = el('aside', 'vision-sidebar');
  const brand = el('div', 'vision-brand');
  const brandMark = el('span', 'vision-brand-mark'); brandMark.textContent = 'V';
  const brandName = el('span', 'vision-brand-name'); brandName.textContent = 'VisionTV';
  brand.appendChild(brandMark); brand.appendChild(brandName); sidebar.appendChild(brand);

  const nav = el('nav', 'vision-nav');
  nav.appendChild(navButton('home', 'Accueil', 'home'));
  nav.appendChild(navButton('live', 'Chaînes Live TV', 'tv'));
  nav.appendChild(navButton('vod', 'Films', 'film'));
  nav.appendChild(navButton('series', 'Séries', 'clapper'));
  nav.appendChild(navButton('guide', 'Guide TV (EPG)', 'guide'));
  nav.appendChild(navButton('favorites', 'Favoris', 'star'));
  sidebar.appendChild(nav);
  const lowerNav = el('div', 'vision-nav-lower');
  lowerNav.appendChild(navButton('settings', 'Paramètres', 'settings'));
  lowerNav.appendChild(navButton('playlists', 'Changer de profil', 'manage'));
  sidebar.appendChild(lowerNav);

  const main = el('main', 'vision-main');
  main.appendChild(buildTopbar());
  const body = el('div', 'vision-views');
  state.views = {
    home: buildHomeView(),
    favorites: buildFavoritesView(),
    settings: buildSettingsView(),
    playlists: buildPlaylistsView(),
    live: buildListView('live'),
    vod: buildListView('vod'),
    series: buildListView('series'),
    guide: buildGuideView()
  };
  body.appendChild(state.views.home);
  body.appendChild(state.views.favorites);
  body.appendChild(state.views.settings);
  body.appendChild(state.views.playlists);
  body.appendChild(state.views.live);
  body.appendChild(state.views.vod);
  body.appendChild(state.views.series);
  body.appendChild(state.views.guide);
  main.appendChild(body);
  main.appendChild(buildFooter());
  root.appendChild(sidebar); root.appendChild(main);
}

function buildTopbar() {
  const header = el('header', 'vision-topbar');
  const left = el('div', 'topbar-left');
  const mark = el('span', 'topbar-mark'); mark.textContent = 'V'; left.appendChild(mark);
  const name = el('span', 'topbar-name'); name.textContent = 'VisionTV'; left.appendChild(name);
  const links = el('nav', 'topbar-links');
  [['home', 'Explorer'], ['live', 'En direct'], ['vod', 'Cinéma'], ['series', 'Séries']].forEach(function (entry) {
    const b = tabButton(entry[0], entry[1]); b.classList.add('top-link'); links.appendChild(b);
  });
  left.appendChild(links); header.appendChild(left);

  const status = el('div', 'topbar-status');
  const net = el('span', 'status-pill'); net.appendChild(svgIcon('wifi', 17));
  const netText = el('span'); netText.textContent = 'TV prête'; net.appendChild(netText); status.appendChild(net);
  const quality = el('span', 'status-pill'); quality.appendChild(svgIcon('hdr', 17));
  const qualityText = el('span'); const webosMajor = ctx && ctx.capabilities && ctx.capabilities.webosVersion ? ctx.capabilities.webosVersion.major : 5; qualityText.textContent = 'webOS ' + webosMajor; quality.appendChild(qualityText); status.appendChild(quality);
  const clock = el('time', 'status-clock'); clock.textContent = '--:--'; status.appendChild(clock);
  const profile = el('button', 'topbar-profile'); profile.tabIndex = 0; profile.setAttribute('data-tab', 'playlists');
  const avatar = el('span', 'topbar-avatar'); avatar.textContent = 'V';
  const profileName = el('span'); profileName.textContent = 'Profil';
  profile.appendChild(avatar); profile.appendChild(profileName);
  profile.addEventListener('click', function () { state.tab = 'playlists'; renderTab(); }); status.appendChild(profile);
  header.appendChild(status);
  state.topbarRefs = { clock: clock, profile: profile, avatar: avatar, profileName: profileName };
  updateTopClock();
  if (!state.topClockTimer) state.topClockTimer = setInterval(updateTopClock, 30000);
  return header;
}

function updateTopClock() {
  if (!state.topbarRefs || !state.topbarRefs.clock) return;
  const now = new Date();
  state.topbarRefs.clock.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

function buildFooter() {
  const footer = el('footer', 'vision-footer');
  const left = el('div', 'footer-hints');
  [['▲▼', 'Naviguer'], ['OK', 'Valider'], ['◀', 'Retour'], ['Y', 'Options']].forEach(function (entry) {
    const hint = el('span', 'footer-hint');
    const key = el('b'); key.textContent = entry[0]; hint.appendChild(key);
    const label = el('span'); label.textContent = entry[1]; hint.appendChild(label); left.appendChild(hint);
  });
  footer.appendChild(left);
  const right = el('span', 'footer-brand'); right.textContent = 'Magic Remote  ·  D-Pad Ready'; footer.appendChild(right);
  return footer;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function svgIcon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size || 24)); svg.setAttribute('height', String(size || 24));
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('svg-icon');
  const paths = {
    home: 'M3 10.5 12 3l9 7.5v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    tv: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M8 22h8 M12 18v4',
    film: 'M4 4h16v16H4z M4 9h16 M4 15h16 M8 4v5 M16 4v5 M8 15v5 M16 15v5',
    clapper: 'M3 7h18v13H3z M3 7l3-4h4L7 7l4-4h4l-3 4 4-4h4l-3 4',
    user: 'M20 21a8 8 0 0 0-16 0 M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4 12H2 M22 12h-2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M12 4V2 M12 22v-2',
    guide: 'M4 5h16v14H4z M4 9h16 M8 5v4 M12 5v4 M16 5v4 M8 13h.01 M12 13h.01 M16 13h.01 M8 16h.01 M12 16h.01 M16 16h.01',
    manage: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M19 8v6 M22 11h-6',
    wifi: 'M2 8.5a16 16 0 0 1 20 0 M5 12a11 11 0 0 1 14 0 M8.5 15.5a6 6 0 0 1 7 0 M12 19h.01',
    hdr: 'M4 5h16v14H4z M8 9h2v6H8z M14 9h2v6h-2z',
    search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M21 21l-4.3-4.3',
    calendar: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h.01 M12 14h.01 M16 14h.01 M8 17h.01 M12 17h.01',
    refresh: 'M20 11a8 8 0 0 0-14.7-4L3 10 M3 5v5h5 M4 13a8 8 0 0 0 14.7 4L21 14 M21 19v-5h-5',
    favorite: 'M12 20.5S4 15.8 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 6.3-8 11-8 11z',
    star: 'M12 3.8l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z',
    play: 'M8 5v14l11-7z',
    pause: 'M8 5v14 M16 5v14',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M5 7h14 M10 11v6 M14 11v6 M8 7l1-3h6l1 3 M7 7l1 14h8l1-14',
    info: 'M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    close: 'M6 6l12 12 M18 6 6 18'
  };
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] || paths.info); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path); return svg;
}

function navButton(tab, label, iconName) {
  const b = tabButton(tab, label);
  b.classList.add('nav-button'); b.appendChild(svgIcon(iconName, 24));
  const text = el('span', 'nav-label'); text.textContent = label; b.appendChild(text);
  return b;
}

function tabButton(tab, label) {
  const b = el('button', 'tab-btn');
  b.setAttribute('aria-label', label); b.setAttribute('data-tab', tab); b.title = label; b.tabIndex = 0;
  b.addEventListener('click', function () { state.tab = tab; renderTab(); });
  return b;
}

function buildHomeView() {
  const view = el('div', 'view view-home');
  const header = el('div', 'page-heading');
  const kicker = el('span', 'eyebrow'); kicker.textContent = 'PORTAIL UTILISATEUR'; header.appendChild(kicker);
  const title = el('h1'); title.textContent = 'Accueil'; header.appendChild(title);
  const subtitle = el('p'); subtitle.textContent = 'Un accès simple à vos chaînes, films et séries.'; header.appendChild(subtitle);
  view.appendChild(header);

  const hero = el('section', 'home-hero');
  const backdrop = el('div', 'hero-backdrop');
  const backdropImage = document.createElement('img'); backdropImage.alt = ''; backdropImage.style.display = 'none'; backdrop.appendChild(backdropImage);
  const scrim = el('div', 'hero-scrim'); backdrop.appendChild(scrim); hero.appendChild(backdrop);
  const heroCopy = el('div', 'hero-copy');
  const heroKicker = el('span', 'hero-kicker'); heroKicker.textContent = 'VISIONTV'; heroCopy.appendChild(heroKicker);
  const heroTitle = el('h2'); heroTitle.textContent = 'Bienvenue sur VisionTV'; heroCopy.appendChild(heroTitle);
  const heroMeta = el('div', 'hero-meta'); heroMeta.textContent = 'TV en direct  ·  Films  ·  Séries'; heroCopy.appendChild(heroMeta);
  const heroPlot = el('p'); heroPlot.textContent = 'Sélectionnez un profil et importez votre accès pour découvrir votre catalogue.'; heroCopy.appendChild(heroPlot);
  const heroActions = el('div', 'hero-actions');
  const heroPlay = button('Regarder en direct', function () {}); heroPlay.classList.add('vision-primary'); heroPlay.insertBefore(svgIcon('play', 20), heroPlay.firstChild);
  const heroGuide = button('Guide des chaînes', function () { state.tab = 'guide'; renderTab(); }); heroGuide.classList.add('vision-secondary'); heroGuide.insertBefore(svgIcon('guide', 19), heroGuide.firstChild);
  const heroFav = button('', function () {}); heroFav.classList.add('icon-button', 'hero-favorite'); heroFav.setAttribute('aria-label', 'Ajouter aux favoris'); heroFav.appendChild(svgIcon('favorite', 21));
  heroActions.appendChild(heroPlay); heroActions.appendChild(heroGuide); heroActions.appendChild(heroFav); heroCopy.appendChild(heroActions); hero.appendChild(heroCopy); view.appendChild(hero);

  const universHead = sectionHeader('Les univers VisionTV', '4 accès rapides', null); view.appendChild(universHead);
  const univers = el('div', 'universe-row');
  [['live', 'tv', 'Direct TV', 'Flux temps réel'], ['vod', 'film', 'Films VOD', 'Catalogue cinéma'], ['series', 'clapper', 'Séries TV', 'Intégrales et épisodes'], ['guide', 'guide', 'Guide EPG', 'Programmes à suivre']].forEach(function (entry) {
    const card = button('', function () { state.tab = entry[0]; renderTab(); }); card.classList.add('universe-card');
    card.appendChild(svgIcon(entry[1], 29)); const copy = el('span', 'universe-copy');
    const name = el('strong'); name.textContent = entry[2]; const desc = el('small'); desc.textContent = entry[3];
    copy.appendChild(name); copy.appendChild(desc); card.appendChild(copy); univers.appendChild(card);
  }); view.appendChild(univers);

  const liveHead = sectionHeader('Mes chaînes favorites', 'Voir tout', function () { state.tab = 'live'; renderTab(); }); view.appendChild(liveHead);
  const liveRow = el('div', 'home-card-row'); view.appendChild(liveRow);
  const continueHead = sectionHeader('Tendances du catalogue', 'Explorer les films', function () { state.tab = 'vod'; renderTab(); }); view.appendChild(continueHead);
  const contentRow = el('div', 'home-card-row'); view.appendChild(contentRow);
  state.homeRefs = { view: view, hero: hero, backdropImage: backdropImage, heroTitle: heroTitle,
    heroMeta: heroMeta, heroPlot: heroPlot, heroKicker: heroKicker, heroPlay: heroPlay,
    liveRow: liveRow, contentRow: contentRow, heroFavorite: heroFav };
  return view;
}

function sectionHeader(label, actionLabel, onClick) {
  const head = el('div', 'section-header');
  const h = el('h2'); h.textContent = label; head.appendChild(h);
  if (actionLabel) {
    const action = onClick ? button(actionLabel, onClick) : el('span', 'section-action');
    if (!onClick) action.textContent = actionLabel;
    action.classList.add('section-action'); head.appendChild(action);
  }
  return head;
}

function updateActiveProfileBadge() {
  if (!state.topbarRefs) return;
  const active = state.playlists.filter(function (p) { return p.id === state.activePlaylistId; })[0];
  const profileName = active ? String(active.name || 'Profil') : 'Profil';
  state.topbarRefs.profileName.textContent = profileName;
  state.topbarRefs.avatar.textContent = profileName.slice(0, 1).toUpperCase();
}

function renderHomeView() {
  const refs = state.homeRefs;
  if (!refs) return;
  updateActiveProfileBadge();
  const live = lists.live && lists.live.items ? lists.live.items.slice(0, 8) : [];
  const vod = lists.vod && lists.vod.items ? lists.vod.items.slice(0, 8) : [];
  const lead = live.length ? live[0] : (vod.length ? vod[0] : null);
  refs.heroKicker.textContent = lead ? (live.length ? 'EN DIRECT' : 'À LA UNE') : 'VISIONTV';
  refs.heroTitle.textContent = lead ? String(lead.name || 'Votre programme') : 'Bienvenue sur VisionTV';
  refs.heroMeta.textContent = lead ? [lead.groupName, lead.rating ? '★ ' + lead.rating : '', lead.releaseDate].filter(Boolean).join('  ·  ') : 'TV en direct  ·  Films  ·  Séries';
  refs.heroPlot.textContent = lead && lead.plot ? String(lead.plot) : 'Sélectionnez un profil et importez votre accès pour découvrir votre catalogue.';
  refs.backdropImage.style.display = lead && lead.logo ? '' : 'none';
  if (lead && lead.logo) refs.backdropImage.src = String(lead.logo);
  refs.heroPlay.textContent = '';
  refs.heroPlay.appendChild(svgIcon(lead ? 'play' : 'refresh', 20));
  refs.heroPlay.appendChild(document.createTextNode(lead ? 'Regarder en direct' : 'Importer une playlist'));
  refs.heroPlay.onclick = function () {
    if (lead) activateChannel(live.length ? 'live' : 'vod', lead, 0);
    else if (state.activePlaylistId != null) runImport(state.activePlaylistId, false);
    else { state.tab = 'playlists'; renderTab(); }
  };
  const leadKind = live.length ? 'live' : 'vod';
  refs.heroFavorite.disabled = !lead;
  setFavoriteControl(refs.heroFavorite, false);
  refs.heroFavorite.onclick = function () {};
  if (lead) {
    refs.heroFavorite.onclick = function () { toggleFavorite(leadKind, lead, refs.heroFavorite); };
    syncFavoriteControl(refs.heroFavorite, leadKind, lead);
  }
  renderHomeCards(refs.liveRow, live, 'live', 'Aucune chaîne importée');
  renderHomeCards(refs.contentRow, vod, 'vod', 'Ouvrez Films pour charger le catalogue VOD');
}

function appendMediaCardContents(host, item, kind) {
  const thumb = el('span', 'content-thumb');
  if (item.logo) { const img = document.createElement('img'); img.src = String(item.logo); img.alt = ''; thumb.appendChild(img); }
  else { const letter = el('span'); letter.textContent = String(item.name || 'V').slice(0, 1).toUpperCase(); thumb.appendChild(letter); }
  const cardTitle = el('span', 'content-title'); cardTitle.textContent = String(item.name || 'Sans titre');
  const cardMeta = el('small'); cardMeta.textContent = kind === 'live' ? 'En direct' : (item.groupName || 'Catalogue');
  host.appendChild(thumb); host.appendChild(cardTitle); host.appendChild(cardMeta);
}

function renderCatalogRow(kind, row, item) {
  let fav = row.querySelector('.row-favorite');
  if (!fav) {
    fav = document.createElement('button');
    fav.className = 'row-favorite';
    fav.tabIndex = -1;
    fav.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (row._favoriteItem) toggleFavorite(row._favoriteKind, row._favoriteItem, fav);
    });
    row.appendChild(fav);
  }
  row._favoriteKind = kind;
  row._favoriteItem = item;
  setFavoriteControl(fav, false);
  syncFavoriteControl(fav, kind, item);
}

function renderHomeCards(host, rows, kind, emptyText) {
  host.innerHTML = '';
  if (!rows.length) {
    const empty = el('div', 'home-empty-card'); empty.appendChild(svgIcon(kind === 'live' ? 'tv' : 'film', 28));
    const copy = el('span'); copy.textContent = emptyText; empty.appendChild(copy); host.appendChild(empty); return;
  }
  rows.forEach(function (item, index) {
    const card = el('article', 'content-card');
    const main = button('', function () { activateChannel(kind, item, index); }); main.classList.add('content-card-main');
    appendMediaCardContents(main, item, kind);
    const fav = button('', function () { toggleFavorite(kind, item, fav); }); fav.classList.add('content-fav');
    setFavoriteControl(fav, false);
    card.appendChild(main); card.appendChild(fav); host.appendChild(card);
    syncFavoriteControl(fav, kind, item);
  });
}

function buildFavoritesView() {
  const view = el('div', 'view view-simple view-favorites');
  const head = el('div', 'simple-head');
  const kicker = el('span', 'eyebrow'); kicker.textContent = 'VOS SÉLECTIONS'; head.appendChild(kicker);
  const title = el('h1'); title.textContent = 'Favoris'; head.appendChild(title);
  const sub = el('p'); sub.textContent = 'Retrouvez vos chaînes et programmes préférés au même endroit.'; head.appendChild(sub); view.appendChild(head);
  const grid = el('div', 'favorite-grid'); view.appendChild(grid);
  const empty = el('div', 'simple-empty'); empty.appendChild(svgIcon('favorite', 42));
  const emptyTitle = el('h2'); emptyTitle.textContent = 'Aucun favori pour le moment'; empty.appendChild(emptyTitle);
  const emptyText = el('p'); emptyText.textContent = 'Ouvrez un catalogue ou l’Accueil pour sélectionner un contenu avec la télécommande.'; empty.appendChild(emptyText);
  const browse = button('Parcourir les chaînes', function () { state.tab = 'live'; renderTab(); }); browse.classList.add('vision-primary'); empty.appendChild(browse);
  view.appendChild(empty);
  state.favoriteRefs = { view: view, grid: grid, empty: empty };
  return view;
}

function favoriteSourceKey(kind, item) {
  item = item || {};
  if (kind === 'live' && item.channelId) return 'channel:' + String(item.channelId);
  if (kind === 'series' && item.seriesId) return 'series:' + String(item.seriesId);
  if (kind === 'vod' && item.id) {
    const id = String(item.id); const cut = id.lastIndexOf(':');
    return 'vod:' + (cut >= 0 ? id.substring(cut + 1) : id);
  }
  if (item.streamUrl) return kind + ':url:' + String(item.streamUrl);
  return kind + ':name:' + String(item.name || '');
}

async function loadFavoritesForActive() {
  if (!ctx || state.activePlaylistId == null || !ctx.db.favorites) { state.favorites = []; return; }
  try {
    state.favorites = await ctx.db.favorites.where('playlistId').equals(state.activePlaylistId).sortBy('createdAt');
    if (state.favorites.length > 100) state.favorites = state.favorites.slice(-100);
  } catch (err) {
    state.favorites = [];
    if (osd) osd.setStatus('Favoris : stockage indisponible');
  }
}

async function findFavorite(kind, item) {
  if (!ctx || state.activePlaylistId == null || !ctx.db.favorites) return null;
  return ctx.db.favorites.where('[playlistId+kind+sourceKey]')
    .equals([state.activePlaylistId, kind, favoriteSourceKey(kind, item)]).first();
}

function setFavoriteControl(control, active) {
  if (!control) return;
  control.innerHTML = '';
  control.appendChild(svgIcon('favorite', 18));
  control.classList.toggle('active', !!active);
  control.setAttribute('aria-pressed', active ? 'true' : 'false');
  control.setAttribute('aria-label', active ? 'Retirer des favoris' : 'Ajouter aux favoris');
}

async function syncFavoriteControl(control, kind, item) {
  const key = kind + '|' + favoriteSourceKey(kind, item);
  if (control) control._favoriteKey = key;
  try {
    const active = !!(await findFavorite(kind, item));
    if (!control || control._favoriteKey !== key) return;
    setFavoriteControl(control, active);
  } catch (err) {
    if (control && control._favoriteKey === key) setFavoriteControl(control, false);
  }
}

async function toggleFavorite(kind, item, control) {
  if (!item || state.activePlaylistId == null || !ctx || !ctx.db.favorites) return;
  try {
    const existing = await findFavorite(kind, item);
    if (existing) {
      await ctx.db.favorites.delete(existing.id);
      setFavoriteControl(control, false);
      if (osd) osd.setStatus('Retiré des favoris');
    } else {
      await ctx.db.favorites.add({
        playlistId: state.activePlaylistId,
        kind: kind,
        sourceKey: favoriteSourceKey(kind, item),
        itemId: item.id || null,
        importId: item.importId || null,
        channelId: item.channelId || null,
        seriesId: item.seriesId || null,
        name: String(item.name || 'Sans titre'),
        groupName: String(item.groupName || ''),
        logo: String(item.logo || ''),
        plot: String(item.plot || ''),
        rating: String(item.rating || ''),
        releaseDate: String(item.releaseDate || ''),
        streamUrl: String(item.streamUrl || ''),
        createdAt: Date.now(), updatedAt: Date.now()
      });
      setFavoriteControl(control, true);
      if (osd) osd.setStatus('Ajouté aux favoris');
    }
    await loadFavoritesForActive();
    if (state.tab === 'favorites') renderFavoritesView();
  } catch (err) {
    if (osd) osd.setStatus('Favoris : ' + ((err && err.message) || err));
  }
}

function favoriteToItem(row) {
  return {
    id: row.itemId, importId: row.importId, channelId: row.channelId, seriesId: row.seriesId,
    name: row.name, groupName: row.groupName, logo: row.logo, plot: row.plot,
    rating: row.rating, releaseDate: row.releaseDate, streamUrl: row.streamUrl
  };
}

function renderFavoritesView() {
  const refs = state.favoriteRefs;
  if (!refs) return;
  refs.grid.innerHTML = '';
  const rows = state.favorites || [];
  refs.empty.style.display = rows.length ? 'none' : 'flex';
  rows.slice().reverse().slice(0, 100).forEach(function (row, index) {
    const item = favoriteToItem(row);
    const card = el('article', 'content-card favorite-card');
    const main = button('', function () { activateChannel(row.kind, item, index); }); main.classList.add('content-card-main');
    appendMediaCardContents(main, item, row.kind);
    const remove = button('', function () { toggleFavorite(row.kind, item, remove); }); remove.classList.add('content-fav', 'active');
    setFavoriteControl(remove, true);
    card.appendChild(main); card.appendChild(remove); refs.grid.appendChild(card);
    syncFavoriteControl(remove, row.kind, item);
  });
  if (state.tab === 'favorites' && engine) engine.setFocusables(visibleFocusables(state.views.favorites, 'button'));
}

function buildSettingsView() {
  const view = el('div', 'view view-settings');
  const head = el('div', 'page-heading');
  const kicker = el('span', 'eyebrow'); kicker.textContent = 'CONFIGURATION SYSTÈME'; head.appendChild(kicker);
  const title = el('h1'); title.textContent = 'Paramètres'; head.appendChild(title);
  const sub = el('p'); sub.textContent = 'Lecture, synchronisation et informations de votre téléviseur webOS.'; head.appendChild(sub); view.appendChild(head);
  const layout = el('div', 'settings-layout');
  const menu = el('nav', 'settings-menu');
  [['Général & Application', 'settings'], ['Playlists & Serveurs', 'manage'], ['Lecteur & Décodage', 'tv'], ['Guide EPG & Logos', 'guide'], ['Diagnostic Réseau', 'wifi']].forEach(function (entry, idx) {
    const b = button(entry[0], function () { if (osd) osd.setStatus('Section « ' + entry[0] + ' »'); }); b.classList.add('settings-menu-item'); if (idx === 0) b.classList.add('selected'); b.insertBefore(svgIcon(entry[1], 23), b.firstChild); menu.appendChild(b);
  });
  const tip = el('div', 'settings-tip'); tip.appendChild(svgIcon('info', 22)); const tipText = el('span'); tipText.textContent = 'Maintenez OK pour modifier un réglage avec la Magic Remote.'; tip.appendChild(tipText); menu.appendChild(tip); layout.appendChild(menu);

  const detail = el('div', 'settings-detail');
  const playerCard = el('section', 'settings-panel');
  const playerHead = el('div', 'settings-panel-head'); const ph = el('h2'); ph.textContent = 'Lecteur & Décodage'; playerHead.appendChild(ph); const phBadge = el('span', 'tech-badge'); phBadge.textContent = 'NATIF WEBOS'; playerHead.appendChild(phBadge); playerCard.appendChild(playerHead);
  const engineRow = el('div', 'settings-row'); const engineLabel = el('div'); const eh = el('strong'); eh.textContent = 'Moteur de lecture principal'; const ep = el('small'); ep.textContent = 'Le lecteur natif reste prioritaire pour préserver le décodage matériel.'; engineLabel.appendChild(eh); engineLabel.appendChild(ep); engineRow.appendChild(engineLabel);
  const engineChoices = el('div', 'segmented'); ['webOS Native', 'HLS secours'].forEach(function (label, idx) { const b = button(label, function () { if (osd) osd.setStatus('Mode lecture : ' + label); }); if (idx === 0) b.classList.add('selected'); engineChoices.appendChild(b); }); engineRow.appendChild(engineChoices); playerCard.appendChild(engineRow);
  const bufferRow = el('div', 'settings-row'); const bl = el('div'); const bh = el('strong'); bh.textContent = 'Buffer vidéo'; const bp = el('small'); bp.textContent = 'Réglage indicatif pour les flux en direct.'; bl.appendChild(bh); bl.appendChild(bp); bufferRow.appendChild(bl); const range = document.createElement('input'); range.type = 'range'; range.min = '1'; range.max = '15'; range.value = '5'; range.tabIndex = 0; range.setAttribute('aria-label', 'Buffer vidéo'); bufferRow.appendChild(range); playerCard.appendChild(bufferRow); detail.appendChild(playerCard);

  const syncCard = el('section', 'settings-panel'); const syncHead = el('div', 'settings-panel-head'); const sh = el('h2'); sh.textContent = 'Playlists & Synchronisation'; syncHead.appendChild(sh); const syncStatus = el('span', 'settings-muted'); syncStatus.textContent = 'Import borné webOS'; syncHead.appendChild(syncStatus); syncCard.appendChild(syncHead);
  const syncGrid = el('div', 'settings-grid'); const syncInfo = el('div', 'settings-info-box'); const siTitle = el('strong'); siTitle.textContent = 'Catalogue actif'; const siValue = el('span'); siValue.textContent = 'Aucun profil sélectionné'; syncInfo.appendChild(siTitle); syncInfo.appendChild(siValue); syncGrid.appendChild(syncInfo);
  const syncActions = el('div', 'settings-action-box'); const syncButton = button('Forcer la synchronisation', function () { if (state.activePlaylistId != null) runImport(state.activePlaylistId, false); }); syncButton.classList.add('vision-primary'); syncButton.insertBefore(svgIcon('refresh', 20), syncButton.firstChild); syncActions.appendChild(syncButton); const epgButton = button('Actualiser l’EPG', function () { if (state.activePlaylistId != null) runImport(state.activePlaylistId, true); }); epgButton.classList.add('vision-secondary'); syncActions.appendChild(epgButton); syncGrid.appendChild(syncActions); syncCard.appendChild(syncGrid); detail.appendChild(syncCard);

  const hardware = el('section', 'settings-panel'); const hwHead = el('div', 'settings-panel-head'); const hwh = el('h2'); hwh.textContent = 'Réseau & Matériel webOS'; hwHead.appendChild(hwh); const online = el('span', 'online-state'); online.textContent = '● Prêt'; hwHead.appendChild(online); hardware.appendChild(hwHead); const hwGrid = el('div', 'hardware-grid');
  [['Téléviseur', 'Détection webOS'], ['Capacités média', 'Lecteur natif + HLS secours'], ['Données locales', 'IndexedDB / import lazy'], ['Réseau', 'Requêtes directes du fournisseur']].forEach(function (entry) { const box = el('div', 'hardware-box'); const lab = el('small'); lab.textContent = entry[0]; const val = el('strong'); val.textContent = entry[1]; box.appendChild(lab); box.appendChild(val); hwGrid.appendChild(box); }); hardware.appendChild(hwGrid); detail.appendChild(hardware);
  layout.appendChild(detail); view.appendChild(layout); state.settingsRefs = { syncValue: siValue }; return view;
}

function renderSettingsView() {
  if (!state.settingsRefs) return;
  const active = state.playlists.filter(function (p) { return p.id === state.activePlaylistId; })[0];
  state.settingsRefs.syncValue.textContent = active ? String(active.name || 'Profil') + (active.activeImportId ? ' · catalogue prêt' : ' · à importer') : 'Aucun profil sélectionné';
}

function buildGuideView() {
  const view = el('div', 'view view-guide');
  const head = el('div', 'page-heading guide-heading');
  const kicker = el('span', 'eyebrow'); kicker.textContent = 'PROGRAMMES EN DIRECT'; head.appendChild(kicker);
  const title = el('h1'); title.textContent = 'Guide TV (EPG)'; head.appendChild(title);
  const sub = el('p'); sub.textContent = 'Naviguez entre vos chaînes et le programme en cours.'; head.appendChild(sub); view.appendChild(head);
  const layout = el('div', 'guide-layout');
  const categories = el('aside', 'guide-categories'); const catTitle = el('h2'); catTitle.textContent = 'Bouquets TV'; categories.appendChild(catTitle); const catHost = el('div', 'guide-category-list'); categories.appendChild(catHost); layout.appendChild(categories);
  const center = el('section', 'guide-channels'); const tools = el('div', 'guide-tools'); const search = input('Rechercher une chaîne…', 'text'); tools.appendChild(search); const reload = button('Actualiser', function () { applySearch('guide', search.value); }); reload.classList.add('vision-secondary'); reload.insertBefore(svgIcon('refresh', 18), reload.firstChild); tools.appendChild(reload); center.appendChild(tools); const scroller = el('div', 'guide-scroller'); center.appendChild(scroller); guideList = new VirtualList(scroller, { itemHeight: 82, overscan: 4, onRender: function (row, item) { renderCatalogRow('live', row, item); } }); guideList.mount(); lists.guide = guideList; search.addEventListener('change', function () { applySearch('guide', search.value); }); scroller.addEventListener('click', function (ev) { let target = ev.target; while (target && target !== scroller && !(target.getAttribute && target.getAttribute('data-index') !== null)) target = target.parentNode; if (!target || target === scroller) return; const idx = parseInt(target.getAttribute('data-index'), 10); if (isNaN(idx)) return; state.selIndex = idx; const item = lists.guide.items[idx]; if (item) { renderGuideDetail(item); syncFocusables('guide'); } }); layout.appendChild(center);
  const detail = el('section', 'guide-detail'); const detailBadge = el('span', 'hero-kicker'); detailBadge.textContent = 'SÉLECTIONNEZ UNE CHAÎNE'; detail.appendChild(detailBadge); const detailTitle = el('h2'); detailTitle.textContent = 'Programme en cours'; detail.appendChild(detailTitle); const detailMeta = el('div', 'guide-detail-meta'); detailMeta.textContent = 'EPG disponible après synchronisation'; detail.appendChild(detailMeta); const detailPlot = el('p'); detailPlot.textContent = 'Le programme en cours et le suivant apparaîtront ici.'; detail.appendChild(detailPlot); const detailActions = el('div', 'hero-actions'); const play = button('Regarder', function () { if (state.guideDetailItem) activateChannel('live', state.guideDetailItem, state.selIndex); }); play.classList.add('vision-primary'); play.insertBefore(svgIcon('play', 19), play.firstChild); detailActions.appendChild(play); const info = button('Actualiser EPG', function () { if (state.activePlaylistId != null) runImport(state.activePlaylistId, true); }); info.classList.add('vision-secondary'); detailActions.appendChild(info); detail.appendChild(detailActions); const schedule = el('div', 'guide-schedule'); detail.appendChild(schedule); layout.appendChild(detail);
  state.guideRefs = { view: view, categories: catHost, search: search, detailTitle: detailTitle, detailMeta: detailMeta, detailPlot: detailPlot, schedule: schedule }; return view;
}

function renderGuideCategories() {
  if (!state.guideRefs) return;
  const host = state.guideRefs.categories; host.innerHTML = '';
  const names = []; const rows = state.items.live || [];
  for (let i = 0; i < rows.length; i++) { const name = String(rows[i].groupName || 'Autres'); if (names.indexOf(name) === -1) names.push(name); }
  const all = [''].concat(names);
  all.forEach(function (name) { const b = button(name || 'Tous les bouquets', function () { state.catFilter.live = name; state.guideCategory = name; applySearch('guide', state.guideRefs.search.value); }); b.classList.add('guide-category'); if ((state.guideCategory || '') === name) b.classList.add('selected'); b.appendChild(svgIcon(name ? 'film' : 'tv', 19)); host.appendChild(b); });
}

async function renderGuideDetail(item) {
  state.guideDetailItem = item;
  if (!state.guideRefs) return;
  state.guideRefs.detailTitle.textContent = String(item.name || 'Chaîne');
  state.guideRefs.detailMeta.textContent = [item.groupName, item.channelId ? 'ID ' + item.channelId : ''].filter(Boolean).join('  ·  ') || 'En direct';
  state.guideRefs.detailPlot.textContent = item.plot ? String(item.plot) : 'Programme en direct sélectionné. Ouvrez la chaîne avec OK.';
  state.guideRefs.schedule.innerHTML = '';
  if (!ctx || !state.activePlaylistId || !item.channelId) return;
  const pl = await ctx.manager.get(state.activePlaylistId); if (!pl || !pl.activeEpgImportId) return;
  const now = Date.now();
  try {
    const epgImportId = pl.activeEpgImportId;
    const rows = await ctx.db.epg.where('[importId+channelId+startTime]').between([epgImportId, item.channelId, now - 12 * 3600 * 1000], [epgImportId, item.channelId, now + CONFIG.EPG_WINDOW_MS], true, true).sortBy('startTime');
    rows.filter(function (ep) { return Number(ep.stopTime || 0) >= now; }).slice(0, 3).forEach(function (ep) { const box = el('div', 'guide-program'); const t = el('strong'); t.textContent = new Date(ep.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); const n = el('span'); n.textContent = String(ep.title || 'Programme'); box.appendChild(t); box.appendChild(n); state.guideRefs.schedule.appendChild(box); });
  } catch (err) { /* EPG optionnel : l'interface reste navigable */ }
}

function buildPlaylistsView() {
  const view = el('div', 'view view-profiles');
  const brand = el('div', 'profile-brand');
  const mark = el('span', 'vision-brand-mark'); mark.textContent = 'V';
  const name = el('span'); name.textContent = 'VisionTV';
  brand.appendChild(mark); brand.appendChild(name); view.appendChild(brand);

  const stage = el('div', 'profile-stage');
  const heading = el('h1'); heading.textContent = 'Qui regarde la TV ?'; stage.appendChild(heading);
  const subtitle = el('p'); subtitle.textContent = 'Sélectionnez un profil pour accéder à vos contenus.'; stage.appendChild(subtitle);
  const empty = el('div', 'profile-empty');
  const monitor = el('div', 'empty-monitor'); monitor.appendChild(el('span', 'empty-screen'));
  empty.appendChild(monitor);
  const emptyTitle = el('strong'); emptyTitle.textContent = 'Aucun profil configuré'; empty.appendChild(emptyTitle);
  const emptyText = el('span'); emptyText.textContent = 'Ajoutez un accès IPTV pour commencer.'; empty.appendChild(emptyText);
  stage.appendChild(empty); state.profileEmptyEl = empty;
  state.plListEl = el('div', 'profile-grid'); stage.appendChild(state.plListEl);

  const add = button('Ajouter un profil', openProfileModal);
  add.classList.add('vision-primary', 'profile-add'); add.insertBefore(svgIcon('plus', 24), add.firstChild);
  stage.appendChild(add); view.appendChild(stage);

  const layer = el('div', 'profile-modal-layer'); layer.style.display = 'none';
  const panel = el('div', 'profile-modal');
  const modalHead = el('div', 'modal-head');
  const modalTitle = el('h2'); modalTitle.textContent = 'Ajouter un accès'; modalHead.appendChild(modalTitle);
  const close = button('', closeProfileModal); close.classList.add('icon-button'); close.appendChild(svgIcon('close', 22));
  modalHead.appendChild(close); panel.appendChild(modalHead);

  const srcS = el('select'); srcS.tabIndex = -1;
  const xOpt = el('option'); xOpt.value = 'xtream'; xOpt.textContent = 'Compte Xtream'; srcS.appendChild(xOpt);
  const mOpt = el('option'); mOpt.value = 'm3u'; mOpt.textContent = 'Lien M3U'; srcS.appendChild(mOpt);
  srcS.classList.add('source-select');
  const sourceTabs = el('div', 'source-tabs');
  const xtab = button('Compte Xtream', function () { srcS.value = 'xtream'; setProfileSource(); });
  const mtab = button('Lien M3U', function () { srcS.value = 'm3u'; setProfileSource(); });
  sourceTabs.appendChild(xtab); sourceTabs.appendChild(mtab); sourceTabs.appendChild(srcS); panel.appendChild(sourceTabs);

  const form = el('div', 'profile-form');
  const nameI = input('Nom du profil (ex : Salon)', 'text');
  const m3uI = input('Lien M3U (https://…)', 'url');
  const epgI = input('Lien XMLTV optionnel (https://…)', 'url');
  const baseI = input('Lien du serveur (http://…)', 'url');
  const userI = input('Username', 'text');
  const passI = input('Password', 'password');
  form.appendChild(nameI); form.appendChild(m3uI); form.appendChild(epgI); form.appendChild(baseI);
  form.appendChild(userI); form.appendChild(passI); panel.appendChild(form);

  const save = button('Connecter', async function () {
    try {
      await ctx.manager.create({ name: nameI.value, source: srcS.value, m3uUrl: m3uI.value,
        epgUrl: epgI.value, base: baseI.value, username: userI.value, password: passI.value });
      closeProfileModal(); await refreshPlaylists(); renderTab();
    } catch (err) { setProfileFormError(err.message); }
  });
  save.classList.add('vision-primary', 'modal-submit'); save.insertBefore(svgIcon('plus', 22), save.firstChild); panel.appendChild(save);
  const error = el('div', 'profile-form-error'); panel.appendChild(error);
  layer.appendChild(panel); view.appendChild(layer);
  state.profileForm = { layer: layer, source: srcS, xtab: xtab, mtab: mtab,
    name: nameI, m3u: m3uI, epg: epgI, base: baseI, user: userI, pass: passI, error: error };
  setProfileSource();
  return view;
}

function setProfileFormError(message) {
  if (state.profileForm) state.profileForm.error.textContent = String(message || '');
}

function setProfileSource() {
  const f = state.profileForm;
  if (!f) return;
  const xtream = f.source.value === 'xtream';
  f.xtab.classList.toggle('selected', xtream); f.mtab.classList.toggle('selected', !xtream);
  f.m3u.style.display = xtream ? 'none' : '';
  f.epg.style.display = xtream ? 'none' : '';
  f.base.style.display = xtream ? '' : 'none';
  f.user.style.display = xtream ? '' : 'none';
  f.pass.style.display = xtream ? '' : 'none';
  f.error.textContent = '';
}

function openProfileModal() {
  if (!state.profileForm) return;
  state.profileForm.layer.style.display = 'flex';
  state.profileForm.name.focus();
  if (engine) engine.setFocusables(visibleFocusables(state.profileForm.layer).filter(function (node) {
    return node !== state.profileForm.source;
  }));
  if (engine && !profileModalBack) {
    profileModalBack = closeProfileModal;
    engine.pushBackHandler(profileModalBack);
  }
}

function closeProfileModal() {
  if (!state.profileForm) return;
  state.profileForm.layer.style.display = 'none';
  state.profileForm.error.textContent = '';
  if (engine && profileModalBack) { engine.removeBackHandler(profileModalBack); profileModalBack = null; }
  if (state.tab === 'playlists' && engine) engine.setFocusables(visibleFocusables(state.views.playlists, 'button'));
}

function input(ph, type) { const i = el('input'); i.tabIndex = 0; i.placeholder = ph; i.type = type || 'text'; return i; }
function field(label, node) { const w = el('label', 'field'); w.appendChild(el('span', 'lbl')); w.firstChild.textContent = label; w.appendChild(node); return w; }
function button(label, onClick) {
  const b = el('button', 'act-btn'); b.textContent = label; b.tabIndex = 0;
  b.addEventListener('click', onClick); return b;
}

function visibleFocusables(container, selector) {
  const nodes = Array.prototype.slice.call(container.querySelectorAll(selector || 'button, input, select'));
  return nodes.filter(function (node) {
    let cur = node;
    while (cur && cur !== document.body) {
      if (cur.style && cur.style.display === 'none') return false;
      cur = cur.parentNode;
    }
    return node.tabIndex !== -1;
  });
}

function buildListView(kind) {
  const view = el('div', 'view view-catalog view-' + kind);
  const catalogHead = el('div', 'catalog-head');
  const heading = el('div', 'catalog-heading');
  const title = el('h1'); title.textContent = kind === 'live' ? 'En direct' : (kind === 'vod' ? 'Films' : 'Séries');
  const sub = el('p'); sub.textContent = kind === 'live' ? 'Vos chaînes et programmes en temps réel.' : 'Un catalogue prêt pour vos soirées.';
  heading.appendChild(title); heading.appendChild(sub); catalogHead.appendChild(heading);
  const hint = el('span', 'remote-hint'); hint.textContent = '↑ ↓ naviguer  ·  OK ouvrir'; catalogHead.appendChild(hint);
  view.appendChild(catalogHead);
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

  lists[kind] = new VirtualList(scroller, { itemHeight: 60, overscan: 4, onRender: function (row, item) { renderCatalogRow(kind, row, item); } });
  lists[kind].mount();
  return view;
}

/* ——————————————————— playlists ——————————————————— */

async function refreshPlaylists() {
  state.playlists = await ctx.manager.list();
  if (state.activePlaylistId === null && state.playlists.length > 0) {
    state.activePlaylistId = state.playlists[0].id;
  }
  updateActiveProfileBadge();
  await loadFavoritesForActive();
  const host = state.plListEl;
  if (!host) return;
  if (state.profileEmptyEl) state.profileEmptyEl.style.display = state.playlists.length ? 'none' : 'flex';
  host.innerHTML = '';
  state.playlists.forEach(function (pl) {
    const card = el('article', 'profile-card');
    const main = el('button', 'profile-card-main'); main.tabIndex = 0;
    const avatar = el('span', 'profile-avatar');
    const profileName = String(pl.name || 'Profil');
    avatar.textContent = profileName.slice(0, 1).toUpperCase();
    const cardText = el('span', 'profile-card-text');
    const title = el('strong'); title.textContent = profileName;
    const meta = el('small'); meta.textContent = (pl.source === 'xtream' ? 'Compte Xtream' : 'Lien M3U') +
      (pl.activeImportId ? ' · catalogue prêt' : ' · à configurer');
    cardText.appendChild(title); cardText.appendChild(meta);
    main.appendChild(avatar); main.appendChild(cardText); main.appendChild(svgIcon('play', 22));
    main.addEventListener('click', function () {
      state.activePlaylistId = pl.id; state.tab = 'home';
      osd && osd.setStatus('Profil actif : ' + profileName); renderTab();
    });
    card.appendChild(main);

    const actions = el('div', 'profile-card-actions');
    const importB = button('Importer', function () { runImport(pl.id, false); });
    importB.classList.add('mini'); actions.appendChild(importB);
    const epgB = button('EPG', function () { runImport(pl.id, true); });
    epgB.classList.add('mini'); actions.appendChild(epgB);
    const cancelB = button('Annuler', function () { ctx.manager.abort(pl.id, 'epg'); ctx.manager.abort(pl.id, 'playlist'); });
    cancelB.classList.add('mini'); actions.appendChild(cancelB);
    const deleteB = button('', async function () {
      await ctx.manager.remove(pl.id);
      if (state.activePlaylistId === pl.id) state.activePlaylistId = null;
      await refreshPlaylists(); renderTab();
    });
    deleteB.classList.add('mini', 'danger-button'); deleteB.setAttribute('aria-label', 'Supprimer ' + profileName);
    deleteB.appendChild(svgIcon('trash', 18)); actions.appendChild(deleteB);
    card.appendChild(actions); host.appendChild(card);
  });
}

async function runImport(playlistId, isEpg) {
  try {
    state.activePlaylistId = playlistId;
    osd && osd.setStatus(isEpg ? 'Import EPG…' : 'Import playlist…');
    const p = isEpg ? ctx.manager.importEpg(playlistId)
      : ctx.manager.importPlaylist(playlistId);
    await p;
  } catch (err) {
    osd && osd.setStatus('Import : ' + err.message);
  }
}

function resetCategorySelector(kind) {
  const sel = catSelects[kind];
  if (!sel) return;
  sel.innerHTML = '';
  const option = el('option');
  option.value = '';
  option.textContent = 'Toutes les catégories';
  sel.appendChild(option);
  sel.value = '';
}

/**
 * V20 : une seule famille de catalogue reste en mémoire côté UI.
 * VirtualList bornait déjà le DOM, mais l'ancien loadActiveData() conservait
 * simultanément live + vod + series sous forme de trois grands tableaux JS.
 */
function clearCatalogMemory() {
  for (let i = 0; i < CATALOG_KINDS.length; i++) {
    const kind = CATALOG_KINDS[i];
    state.items[kind] = [];
    state.catFilter[kind] = '';
    resetCategorySelector(kind);
    if (lists[kind]) {
      lists[kind].setItems([]);
      lists[kind].container.scrollTop = 0;
    }
  }
  if (lists.guide) { lists.guide.setItems([]); lists.guide.container.scrollTop = 0; }
  state.guideCategory = '';
  state.selIndex = -1;
}

function catalogViewIs(kind) {
  return state.tab === kind || ((state.tab === 'home' || state.tab === 'guide') && kind === 'live');
}

async function loadCatalog(kind, token, playlistId) {
  if (CATALOG_KINDS.indexOf(kind) === -1 || playlistId == null) return;
  let rows;
  try {
    rows = await ctx.manager[KIND_TO_MANAGER[kind]](playlistId);
    if (token !== catalogLoadToken || state.activePlaylistId !== playlistId || !catalogViewIs(kind)) return;
    state.items[kind] = rows || [];
    await refreshCategorySelectors(kind, playlistId, token);
    if (token !== catalogLoadToken || state.activePlaylistId !== playlistId || !catalogViewIs(kind)) return;
    applySearch(kind, '');
  } catch (err) {
    if (token === catalogLoadToken && state.activePlaylistId === playlistId && osd) {
      osd.setStatus('Catalogue : ' + ((err && err.message) || err));
    }
  }
}

function loadActiveData() {
  const token = ++catalogLoadToken;
  clearCatalogMemory();
  if (state.activePlaylistId == null) return;
  const kind = (state.tab === 'home' || state.tab === 'guide') ? 'live' : state.tab;
  if (CATALOG_KINDS.indexOf(kind) === -1) return;
  loadCatalog(kind, token, state.activePlaylistId);
}

const KIND_TO_CAT = { live: 'live', vod: 'vod', series: 'series' };
const KIND_TO_MANAGER = { live: 'channels', vod: 'vod', series: 'series' };
async function refreshCategorySelectors(kind, playlistId, token) {
  const sel = catSelects[kind];
  if (!sel) return;
  let catNames = [];
  try {
    const rows = await ctx.manager.categories(playlistId, KIND_TO_CAT[kind]);
    catNames = rows.map(function (r) { return r.name; });
  } catch (err) { catNames = []; }
  if (token !== catalogLoadToken || state.activePlaylistId !== playlistId || !catalogViewIs(kind)) return;
  const catSet = new Set(catNames);
  const extra = [];
  // Le serveur reste la source prioritaire ; si ses catégories sont absentes,
  // les groupName déjà présents permettent malgré tout de conserver un filtre utile.
  const rows = state.items[kind] || [];
  for (let i = 0; i < rows.length; i++) {
    const g = String(rows[i].groupName || 'Autres');
    if (!catSet.has(g)) { catSet.add(g); extra.push(g); }
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
  const sourceKind = kind === 'guide' ? 'live' : kind;
  const norm = String(rawQuery || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let all = state.items[sourceKind] || [];
  const cat = kind === 'guide' ? (state.catFilter.live || '') : (state.catFilter[kind] || '');
  if (cat) all = all.filter(function (r) { return String(r.groupName || 'Autres') === cat; });
  const rows = !norm ? all : all.filter(function (r) {
    return String(r.searchName || '').indexOf(norm) === 0;
  }).slice(0, CONFIG.SEARCH_LIMIT);

  if (lists && lists[kind]) {
    lists[kind].setItems(rows);
    state.selIndex = rows.length ? 0 : -1;
    lists[kind].container.scrollTop = 0;
    lists[kind]._renderWindow();
  }
  // Le guide et l'accueil exploitent le même chargement live sans conserver
  // une deuxième copie du catalogue : seul le pool DOM change de vue.
  if (kind === 'live' && state.tab === 'guide' && lists.guide) {
    lists.guide.setItems(rows); lists.guide.container.scrollTop = 0; lists.guide._renderWindow();
    renderGuideCategories(); syncGuideFocusables(visibleSlice('guide').rows);
  } else if (lists && lists[kind] && state.tab === kind) {
    syncFocusables(kind);
  }
  if (state.tab === 'home') {
    renderHomeView();
    if (engine && state.views && state.views.home) engine.setFocusables(visibleFocusables(state.views.home, 'button'));
  }
  if (state.tab === 'guide') {
    renderGuideCategories();
    if (engine && lists.guide) syncGuideFocusables(visibleSlice('guide').rows);
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
  if (kind === 'guide') {
    syncGuideFocusables(vis.rows);
    return;
  }
  engine.setFocusables(vis.rows);
  engine.currentIndex = vis.rows.length === 0 ? -1
    : Math.max(0, Math.min(vis.rows.length - 1, state.selIndex - vis.start));
}

function syncGuideFocusables(rows) {
  const fixed = state.views && state.views.guide ? visibleFocusables(state.views.guide, 'button, input') : [];
  const all = fixed.concat(rows || []);
  engine.setFocusables(all);
  engine.currentIndex = all.length ? 0 : -1;
}

/* ————————————— V12 §8.4 : routeur télécommande unifié —————————————
   Un seul handler, contextuel (lecteur ouvert / panneau série / liste / champ
   en cours d'édition), branché sur la table pure RemoteKeys. Enregistre AVANT
   le FocusEngine : les touches consommées stoppent la propagation, les autres
   (dont OK sur les boutons des overlays) passent au moteur. */
const moveGate = createRepeatGate(null, 45, 130);
const LIST_TABS = { live: true, vod: true, series: true, guide: true };

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
  if (state.profileForm && state.profileForm.layer.style.display !== 'none' && (e.keyCode === 27 || e.keyCode === 461)) {
    e.preventDefault(); e.stopImmediatePropagation(); closeProfileModal(); return;
  }
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
    if (state.profileForm && state.profileForm.layer.style.display !== 'none') closeProfileModal();
    state.tab = 'home';
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
    if (item) activateChannel(kind === 'guide' ? 'live' : kind, item, state.selIndex);
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
  state.playing = { kind: kind, index: idx != null ? idx : state.selIndex, item: item };
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
let playerProgress = null;
let playerPlayButton = null;
let playerVolumeButton = null;
let playerFavoriteButton = null;

function ensurePlayer() {
  if (adapter) return;
  playerStage = el('div', 'stage');
  videoEl = el('video', 'player');
  videoEl.setAttribute('playsinline', 'playsinline');
  playerStage.appendChild(videoEl);
  const closeB = el('button', 'mini close-player player-action');
  closeB.textContent = 'Retour'; closeB.tabIndex = 0;
  closeB.insertBefore(svgIcon('close', 20), closeB.firstChild);
  closeB.addEventListener('click', closePlayer);
  playerStage.appendChild(closeB);

  const controls = el('div', 'player-controls');
  playerProgress = el('input', 'player-progress'); playerProgress.type = 'range';
  playerProgress.min = '0'; playerProgress.max = '1000'; playerProgress.value = '0'; playerProgress.tabIndex = 0;
  playerProgress.setAttribute('aria-label', 'Position dans la vidéo');
  playerProgress.addEventListener('change', function () {
    if (!videoEl || !isFinite(videoEl.duration) || videoEl.duration <= 0) return;
    videoEl.currentTime = (Number(playerProgress.value) / 1000) * videoEl.duration;
  });
  const progressLine = el('div', 'player-progress-line');
  const elapsed = el('span', 'player-time'); elapsed.textContent = '00:00';
  const total = el('span', 'player-time'); total.textContent = '00:00';
  progressLine.appendChild(elapsed); progressLine.appendChild(playerProgress); progressLine.appendChild(total);
  controls.appendChild(progressLine);
  const actionLine = el('div', 'player-action-line');
  playerPlayButton = el('button', 'player-control'); playerPlayButton.tabIndex = 0; playerPlayButton.setAttribute('aria-label', 'Lecture pause');
  playerPlayButton.addEventListener('click', function () { togglePlayPause(); updatePlayerControls(); });
  actionLine.appendChild(playerPlayButton);
  playerVolumeButton = el('button', 'player-control'); playerVolumeButton.tabIndex = 0; playerVolumeButton.setAttribute('aria-label', 'Volume');
  playerVolumeButton.addEventListener('click', function () { togglePlayerMute(); }); actionLine.appendChild(playerVolumeButton);
  playerFavoriteButton = el('button', 'player-control player-favorite-control'); playerFavoriteButton.tabIndex = 0; playerFavoriteButton.setAttribute('aria-label', 'Favori');
  playerFavoriteButton.addEventListener('click', function () {
    const current = state.playing;
    if (!current || !current.item) return;
    const kind = current.kind === 'episode' ? 'series' : current.kind;
    toggleFavorite(kind, current.item, playerFavoriteButton).then(updatePlayerFavoriteControl);
  }); actionLine.appendChild(playerFavoriteButton);
  const backB = el('button', 'player-control'); backB.tabIndex = 0; backB.textContent = '−10 s';
  backB.addEventListener('click', function () { nudgeSeconds(-10); }); actionLine.appendChild(backB);
  const forwardB = el('button', 'player-control'); forwardB.tabIndex = 0; forwardB.textContent = '+10 s';
  forwardB.addEventListener('click', function () { nudgeSeconds(10); }); actionLine.appendChild(forwardB);
  const fullB = el('button', 'player-control'); fullB.tabIndex = 0; fullB.setAttribute('aria-label', 'Plein écran');
  fullB.appendChild(svgIcon('info', 19)); fullB.appendChild(document.createTextNode(' Plein écran'));
  fullB.addEventListener('click', function () { togglePlayerFullscreen(); }); actionLine.appendChild(fullB);
  controls.appendChild(actionLine); playerStage.appendChild(controls);

  osd = new PlayerOSD(playerStage);
  state.osdEl = playerStage;
  adapter = new MediaAdapter(videoEl);
  adapter.init();
  lifecycle = new LifecycleAdapter(adapter);
  lifecycle.init();
  videoEl.addEventListener('timeupdate', updatePlayerProgress);
  videoEl.addEventListener('durationchange', updatePlayerProgress);
  videoEl.addEventListener('play', updatePlayerControls);
  videoEl.addEventListener('pause', updatePlayerControls);
  updatePlayerControls();
}

function formatPlayerTime(value) {
  const n = isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

function updatePlayerProgress() {
  if (!videoEl || !playerProgress) return;
  const duration = Number(videoEl.duration);
  const current = Number(videoEl.currentTime) || 0;
  playerProgress.value = isFinite(duration) && duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
  const line = playerProgress.parentNode;
  if (line) {
    const times = line.querySelectorAll('.player-time');
    if (times.length > 1) { times[0].textContent = formatPlayerTime(current); times[1].textContent = formatPlayerTime(duration); }
  }
}

function updatePlayerControls() {
  if (!playerPlayButton) return;
  playerPlayButton.innerHTML = '';
  playerPlayButton.appendChild(svgIcon(videoEl && !videoEl.paused ? 'pause' : 'play', 20));
  playerPlayButton.appendChild(document.createTextNode(videoEl && !videoEl.paused ? ' Pause' : ' Lecture'));
  if (playerVolumeButton) {
    playerVolumeButton.innerHTML = '';
    playerVolumeButton.appendChild(document.createTextNode(videoEl && videoEl.muted ? 'Son coupé' : 'Volume'));
  }
}

async function updatePlayerFavoriteControl() {
  const control = playerFavoriteButton;
  if (!control) return;
  const current = state.playing;
  if (!current || !current.item) {
    control.disabled = true;
    setFavoriteControl(control, false);
    control.appendChild(document.createTextNode(' Favori'));
    return;
  }
  const kind = current.kind === 'episode' ? 'series' : current.kind;
  const key = kind + '|' + favoriteSourceKey(kind, current.item);
  control._playerFavoriteKey = key;
  control.disabled = false;
  try {
    const active = !!(await findFavorite(kind, current.item));
    if (control._playerFavoriteKey !== key) return;
    setFavoriteControl(control, active);
    control.appendChild(document.createTextNode(' Favori'));
  } catch (err) {
    if (control._playerFavoriteKey === key) {
      setFavoriteControl(control, false);
      control.appendChild(document.createTextNode(' Favori'));
    }
  }
}

function togglePlayerMute() {
  if (!videoEl) return;
  videoEl.muted = !videoEl.muted; updatePlayerControls();
}

function togglePlayerFullscreen() {
  const target = playerOverlay || playerStage;
  if (!target) return;
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    else if (target.requestFullscreen) target.requestFullscreen();
    else if (osd) osd.setStatus('Plein écran géré par le téléviseur');
  } catch (err) { if (osd) osd.setStatus('Plein écran indisponible'); }
}

function openPlayer() {
  ensurePlayer();
  if (playerOpen) return;
  playerOpen = true;
  state.playerOpen = true;
  playerOverlay = el('div', 'player-overlay');
  playerOverlay.appendChild(playerStage);
  document.body.appendChild(playerOverlay);
  engine.setFocusables(Array.prototype.slice.call(playerStage.querySelectorAll('button, input')));
  updatePlayerFavoriteControl();
  engine.pushBackHandler(closePlayer);
}

function closePlayer() {
  if (!playerOpen) return;
  playerOpen = false;
  state.playerOpen = false;
  state.playing = null;
  updatePlayerFavoriteControl();
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
  state.playing = { kind: 'episode', pl: pl, series: series, item: series, season: season,
                    episodes: season.episodes, epIndex: epIndex != null ? epIndex : 0 };
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
  if (!pl || !pl.activeEpgImportId) { osd.setEpg('', ''); return; }
  const now = Date.now();
  const imp = pl.activeEpgImportId, ch = item.channelId;
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

  window.addEventListener('import-complete', function (event) {
    const detail = event && event.detail ? event.detail : {};
    osd && osd.setStatus('Import terminé');
    refreshPlaylists().then(function () {
      // Un import EPG ne modifie aucun catalogue. Un import playlist invalide
      // seulement la vue actuellement affichée ; les deux autres restent vides.
      if (detail.kind === 'playlist') loadActiveData();
    });
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
  if (state.profileForm && state.profileForm.layer.style.display !== 'none' && state.tab !== 'playlists') closeProfileModal();
  const tabs = ['home', 'playlists', 'favorites', 'settings', 'live', 'vod', 'series', 'guide'];
  for (let i = 0; i < tabs.length; i++) {
    const key = tabs[i];
    if (state.views[key]) state.views[key].style.display = state.tab === key ? '' : 'none';
  }
  root.classList.toggle('profile-mode', state.tab === 'playlists');
  const navs = root.querySelectorAll('[data-tab]');
  for (let n = 0; n < navs.length; n++) navs[n].classList.toggle('active', navs[n].getAttribute('data-tab') === state.tab);

  if (state.tab === 'home' || state.tab === 'guide' || CATALOG_KINDS.indexOf(state.tab) !== -1) {
    // Un seul catalogue est demandé : le guide partage le chargement live.
    loadActiveData();
  } else {
    catalogLoadToken++;
    clearCatalogMemory();
    const focusView = state.views[state.tab] || state.views.playlists;
    engine.setFocusables(visibleFocusables(focusView, 'button, input, select'));
  }
  if (state.tab === 'home') {
    renderHomeView();
    engine.setFocusables(visibleFocusables(state.views.home, 'button'));
  } else if (state.tab === 'favorites') {
    loadFavoritesForActive().then(function () { if (state.tab === 'favorites') renderFavoritesView(); });
    renderFavoritesView();
  } else if (state.tab === 'settings') {
    renderSettingsView();
  } else if (state.tab === 'guide') {
    renderGuideCategories();
    syncGuideFocusables(lists.guide ? visibleSlice('guide').rows : []);
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
