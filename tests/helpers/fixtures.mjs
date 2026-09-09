// tests/helpers/fixtures.mjs — générateurs déterministes des fixtures §9
// + routeur fetch (les URLs « fixture » sont résolues par fetchRouter).
import { setRoute, clearRoutes } from './fetchRouter.mjs';

export function buildM3U(count, groupCount, opts) {
  opts = opts || {};
  const lines = ['#EXTM3U'];
  for (let i = 0; i < count; i++) {
    const g = 'Groupe ' + (i % groupCount);
    const name = 'Channel ' + (i + 1);
    lines.push('#EXTINF:-1 tvg-id="ch' + i + '" tvg-logo="http://logo/' + i + '.png" group-title="' + g + '",' + name);
    lines.push('http://stream.example/live/' + i + '.m3u8');
  }
  if (opts.accented) {
    lines.push('#EXTINF:-1 tvg-id="accent1",Chaîne Café Événement');
    lines.push('http://stream.example/live/acc.m3u8');
  }
  if (opts.extgrp) {
    lines.push('#EXTINF:-1,tv sans group');
    lines.push('#EXTGRP:Groupe EXTGRP');
    lines.push('http://stream.example/live/nogroup.m3u8');
  }
  if (opts.trailingExtinf) {
    lines.push('#EXTINF:-1,Orpheline sans URL');
  }
  return lines.join('\n') + '\n';
}

export function xmltvHeader() { return '<?xml version="1.0"?><tv>'; }
export function xmltvFooter() { return '</tv>'; }

export function program(channel, start, stop, title) {
  return '<programme channel="' + channel + '" start="' + start + '" stop="' + stop + '">' +
         '<title>' + title + '</title></programme>';
}

export function buildXmltv(n, opts) {
  opts = opts || {};
  const base = opts.baseUtcMs || Date.UTC(2026, 0, 1, 12, 0, 0);
  const step = opts.stepMs || 1800000;
  const parts = [xmltvHeader()];
  for (let i = 0; i < n; i++) {
    const start = fmt(new Date(base + i * step));
    const stop = fmt(new Date(base + (i + 1) * step));
    parts.push(program('ch' + (i % 10), start, stop, 'Titre ' + (i + 1)));
  }
  parts.push(xmltvFooter());
  return parts.join('');
}

function fmt(d) {
  const p = (x, l) => String(x).padStart(l || 2, '0');
  return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
         p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

/** Route une URL fixture (chaîne ou XMLTV) pour le fetchRouter. */
export function routeText(url, text, opts) { setRoute(url, text, opts); }

/** Panel Xtream simulé : 2 catégories live (3+2), 1 catégorie vod (4 films). */
export const XTREAM_PANEL = {
  account: {
    user_info: { status: 'Active', max_connections: '2', exp_date: '2027-01-01' }
  },
  liveCategories: [
    { category_id: '10', category_name: 'Infos' },
    { category_id: '20', category_name: 'Sports' }
  ],
  liveStreams: {
    10: [
      { stream_id: '101', name: 'News 24', epg_channel_id: 'news24.example', stream_icon: '' },
      { stream_id: '102', name: 'Matin TV', epg_channel_id: 'matintv.example', stream_icon: '' },
      { stream_id: '103', name: 'Soir Live', epg_channel_id: null, stream_icon: '' }
    ],
    20: [
      { stream_id: '201', name: 'Football Arena', epg_channel_id: 'foot.example', stream_icon: '' },
      { stream_id: '202', name: 'Tennis Club', epg_channel_id: 'tennis.example', stream_icon: '' }
    ]
  },
  vodCategories: [ { category_id: '900', category_name: 'Cinéma' } ],
  vodStreams: {
    900: [
      { stream_id: '901', name: 'Film Alpha', stream_icon: '', container_extension: 'mkv' },
      { stream_id: '902', name: 'Film Beta', stream_icon: '', container_extension: 'mp4' },
      { stream_id: '903', name: 'Film Gamma', stream_icon: '' },
      { stream_id: '904', name: 'Chaîne Café VOD', stream_icon: '', container_extension: 'ts' }
    ]
  },
  EXPECTED: { channels: 5, vod: 4, maxConnections: 2 }
};

export function routeXtreamPanel(base, username, password, overrides) {
  const qp = (v) => encodeURIComponent(String(v));
  const api = base + '/player_api.php?username=' + qp(username) + '&password=' + qp(password);
  const withAction = (a) => api + '&action=' + a;
  const ov = overrides || {};

  clearRoutes();
  setRoute(api, ov.account !== undefined ? ov.account : XTREAM_PANEL.account);
  setRoute(withAction('get_live_categories'),
           ov.liveCategories !== undefined ? ov.liveCategories : XTREAM_PANEL.liveCategories);
  setRoute(withAction('get_vod_categories'),
           ov.vodCategories !== undefined ? ov.vodCategories : XTREAM_PANEL.vodCategories);
  for (const catId of Object.keys(XTREAM_PANEL.liveStreams)) {
    setRoute(withAction('get_live_streams') + '&category_id=' + catId,
             (ov.failLiveCat === catId)
               ? null
               : XTREAM_PANEL.liveStreams[catId],
             (ov.failLiveCat === catId) ? { status: 503 } : {});
  }
  for (const catId of Object.keys(XTREAM_PANEL.vodStreams)) {
    setRoute(withAction('get_vod_streams') + '&category_id=' + catId,
             XTREAM_PANEL.vodStreams[catId]);
  }
}
