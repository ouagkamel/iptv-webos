// src/platform/XtreamClient.js — spec §6.5 (verbatim).
// Stateless ; aucun fetch ici (le worker les fait). XP-3 : jamais journaliser.
function qp(v) { return encodeURIComponent(String(v == null ? '' : v)); }

export const XtreamClient = {
  normalizeBase(input) {
    const base = String(input || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('XTREAM_BASE_URL_INVALID');
    return base;
  },
  apiBase(base, u, p) {
    return base + '/player_api.php?username=' + qp(u) + '&password=' + qp(p);
  },
  accountUrl(base, u, p) { return this.apiBase(base, u, p); },
  categoriesUrl(base, u, p, action) { return this.apiBase(base, u, p) + '&action=' + action; },
  listUrl(base, u, p, action, categoryId) {
    return this.categoriesUrl(base, u, p, action) +
           (categoryId != null ? '&category_id=' + qp(categoryId) : '');
  },
  epgXmltvUrl(base, u, p) { return base + '/xmltv.php?username=' + qp(u) + '&password=' + qp(p); },
  liveStreamUrl(base, u, p, streamId) {
    return base + '/live/' + qp(u) + '/' + qp(p) + '/' + qp(streamId) + '.m3u8';
  },
  vodStreamUrl(base, u, p, streamId, ext) {
    return base + '/movie/' + qp(u) + '/' + qp(p) + '/' + qp(streamId) + '.' + (ext || 'mp4');
  }
};
