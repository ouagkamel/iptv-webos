// src/ui/RemoteKeys.js — V12 §8.4 : routage télécommande, logique pure et testable.
// Le FocusEngine (§8.1 verbatim) reste moteur de focus ; ce module ne fait que
// CLASSER la touche selon le contexte, l'app exécute. Aucun DOM ici.
//
// Contexte attendu par classifyKey(e, ctx) :
//   ctx.inPlayer        — overlay lecteur ouvert
//   ctx.inSeriesOverlay — overlay détail de série ouvert
//   ctx.seriesLevel     — 'seasons' | 'episodes' | null
//   ctx.editing         — cible INPUT/TEXTAREA/SELECT (les champs gardent leurs touches)
//   ctx.tab             — 'live' | 'vod' | 'series' | 'playlists'

export const KEY = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, OK: 13, BACK_ALT: 27,
  PAGE_UP: 33, PAGE_DOWN: 34,
  MEDIA_PLAY_PAUSE: 415, MEDIA_PLAY: 448, MEDIA_PAUSE: 19, MEDIA_STOP: 413,
  MEDIA_PREV: 412, MEDIA_NEXT: 414, MEDIA_REWIND: 417, MEDIA_FF: 419,
  INFO: 457, HOME: 402, WEBOS_BACK: 461
};

// La touche OK sur un <select>/<input> est native (ouvrir/valeur) : ne JAMAIS
// la voler ; les flèches sur un select ouvert idem. Seule Enter dans le champ
// recherche est transformée en « lancer la recherche » ('form-enter').
export function classifyKey(keyCode, ctx) {
  ctx = ctx || {};
  if (ctx.editing) {
    if (keyCode === KEY.OK && ctx.editKind === 'input') return 'form-enter';
    return null;
  }
  if (ctx.inSeriesOverlay) {
    // OK/Entrée : JAMAIS volé ici — le FocusEngine le convertit en 'focus-activate'
    // et le consommateur de l'app déclenche .click() sur l'élément focusé (boutons
    // natifs du panneau : saisons, épisodes, Fermer, Réessayer).
    if (keyCode === KEY.LEFT && ctx.seriesLevel === 'episodes') return 'series-step-back';
    if (keyCode === KEY.BACK_ALT || keyCode === KEY.WEBOS_BACK || keyCode === KEY.MEDIA_STOP) return 'series-back';
    if (keyCode === KEY.INFO) return 'osd';
    if (keyCode === KEY.HOME) return 'home';
    return null; // flèches : navigation FocusEngine dans l'overlay
  }
  if (ctx.inPlayer) {
    switch (keyCode) {
      case KEY.MEDIA_PLAY_PAUSE: case KEY.MEDIA_PLAY: case KEY.MEDIA_PAUSE: return 'playpause';
      case KEY.MEDIA_STOP: case KEY.BACK_ALT: case KEY.WEBOS_BACK: return 'close-player';
      case KEY.DOWN: case KEY.MEDIA_NEXT: case KEY.PAGE_DOWN: return 'zap-next';
      case KEY.UP: case KEY.MEDIA_PREV: case KEY.PAGE_UP: return 'zap-prev';
      case KEY.MEDIA_REWIND: return ctx.zappableSeek ? 'seek-back' : null;
      case KEY.MEDIA_FF: return ctx.zappableSeek ? 'seek-fwd' : null;
      case KEY.INFO: return 'osd';
      case KEY.HOME: return 'home';
      default: return null;
    }
  }
  // Hors overlay/lecteur : navigation des listes (l'onglet playlists garde la
  // navigation native du moteur de focus).
  if (ctx.tab === 'live' || ctx.tab === 'vod' || ctx.tab === 'series') {
    switch (keyCode) {
      case KEY.DOWN: return 'row-next';
      case KEY.UP: return 'row-prev';
      case KEY.RIGHT: case KEY.PAGE_DOWN: return 'page-next';
      case KEY.LEFT: case KEY.PAGE_UP: return 'page-prev';
      case KEY.OK: return 'activate';
      case KEY.MEDIA_PLAY_PAUSE: case KEY.MEDIA_PLAY: case KEY.MEDIA_NEXT: return 'activate';
      case KEY.INFO: return 'osd';
      case KEY.HOME: return 'home';
      case KEY.BACK_ALT: case KEY.WEBOS_BACK: case KEY.MEDIA_STOP: return null; // moteur (pile LIFO / platformBack)
      default: return null;
    }
  }
  if (keyCode === KEY.HOME) return 'home';
  return null;
}

// ————— index helpers (wrap circulaire comme la liste actuelle) —————

export function stepIndex(total, index, delta) {
  if (!total || total <= 0) return -1;
  const cur = index < 0 ? 0 : index >= total ? total - 1 : index;
  return (cur + delta + total) % total;
}

// Page = une hauteur de fenêtre de lignes ; < 1 → traité comme ±1 ligne.
// La boucle est circulaire (télécommande : pas de cul-de-sac en haut/bas).
export function pageIndex(total, index, rowsPerPage) {
  if (!total || total <= 0) return -1;
  const n = Math.max(1, Math.abs(Math.floor(rowsPerPage || 1)));
  const cur = index < 0 ? 0 : Math.min(index, total - 1);
  if ((rowsPerPage || 1) < 0) { const prev = cur - n; return prev < 0 ? total - 1 : prev; }
  const next = cur + n;
  return next >= total ? next % total : next;
}

// ————— anti-tempête de répétition —————
// WebOS répète la touche ~30 ms en maintien : sans garde, chaque appui zap
// relance un flux (coûteux) et chaque mouvement re-render la fenêtre.
// Gate simple : un pas autorisé tous les minMs ; l'horloge est injectable
// (testable) et aucune file d'attente (le dernier pas perdu est sans importance).
export function createRepeatGate(clock, minMs, minMsZap) {
  const now = clock || function () { return Date.now(); };
  var last = {};
  minMs = minMs || 45;
  minMsZap = minMsZap || 120;
  return function allow(kind) {
    var ms = (kind === 'zap-next' || kind === 'zap-prev') ? minMsZap : minMs;
    var t = now();
    var l = last[kind];
    if (l != null && t - l < ms) return false;
    last[kind] = t;
    return true;
  };
}
