#!/usr/bin/env node
// tools/panel-proxy.mjs — proxy de TEST uniquement (desktop/simulateur).
// Pourquoi : les panneaux Xtream autorisent les segments /hls/<session>/ via une
// session liée à des cookies et à la consistance de l'origine ; Chromium ≥ 80 (donc
// les simulateurs webOS récents) NE TRANSMET PAS les cookies cross-site sur les
// requêtes média/fetch (SameSite=Lax par défaut) → segments 403 alors que la TV
// (webOS 5/6 = Chromium ≤ 79, et le moteur natif côté TV) les joue sans souci.
// Ce proxy rend le panneau same-origin (http://127.0.0.1:<port>) : cookies, CORS,
// referer et enchaînement des redirects deviennent cohérents. N'utiliser que pour
// tester — l'app sur TV cible se passe de proxy.
//
// Usage : node tools/panel-proxy.mjs --target http://panel:port [--port 8091]
// Puis, dans l'UI : Base Xtream = http://127.0.0.1:<port>  (mêmes user/mot de passe).
import http from 'node:http';

const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : dflt;
}
const TARGET = String(flag('target', 'http://127.0.0.1:8080')).replace(/\/+$/, '');
const PORT = parseInt(flag('port', '8091'), 10);
const up = new URL(TARGET);
const UP_HOST = up.host;
// UA d'origine si absente : certains CDN refusent les UA vides/outillées.
const UA_FALLBACK = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager';

function rewriteLocation(loc) {
  // Les 302 des panneaux pointent vers un edge (autre hôte/port) : on ramène la
  // cible en chemin relatif — le navigateur la résout contre NOUS (même origin),
  // et le proxy connaît l'upstream réel (même hôte, juste la path compte).
  return String(loc).replace(/^https?:\/\/[^/]+/, '');
}

const server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-max-age': '600'
    });
    res.end(); return;
  }
  const headers = {};
  for (const k in req.headers) headers[k] = req.headers[k];
  headers.host = UP_HOST;
  headers.origin = TARGET;
  headers.referer = TARGET + '/';
  // Certains CDN de panneaux bloquent les UA outillées (curl/node/python → 461) :
  // on force une UA d'appareil dans ce cas, sinon on relaie l'UA du navigateur.
  if (!headers['user-agent'] || /curl|wget|python|node-fetch|okhttp|libwww/i.test(headers['user-agent'])) {
    headers['user-agent'] = UA_FALLBACK;
  }
  const upstream = http.request({
    host: up.hostname,
    port: up.port || 80,
    method: req.method,
    path: req.url,
    headers: headers
  }, function (ur) {
    const h = {};
    for (const k in ur.headers) h[k] = ur.headers[k];
    if (h.location) h.location = rewriteLocation(h.location);
    if (h['set-cookie']) {
      h['set-cookie'] = [].concat(h['set-cookie']).map(function (c) {
        return c.replace(/;\s*domain=[^;]+/i, '').replace(/;\s*secure/i, '')
                .replace(/;\s*samesite=[^;]+/i, '; SameSite=Lax');
      });
    }
    h['access-control-allow-origin'] = req.headers.origin || '*';
    h['access-control-allow-credentials'] = 'true';
    delete h['content-length']; // chunked ou re-taille ; plus simple : on propagate en streaming
    delete h['content-encoding']; // node a déjà décodé ? NON : http ne décode pas → garder. On retire seulement si identity.
    if (ur.headers['content-encoding']) h['content-encoding'] = ur.headers['content-encoding'];
    res.writeHead(ur.statusCode, h);
    ur.pipe(res);
    ur.on('error', function () { res.destroy(); });
  });
  upstream.on('error', function (e) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('panel-proxy upstream: ' + e.message);
  });
  req.pipe(upstream);
  req.on('aborted', function () { upstream.destroy(); });
  res.on('close', function () { upstream.destroy(); });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('panel-proxy :' + PORT + ' → ' + TARGET);
  console.log('UI : Base Xtream = http://127.0.0.1:' + PORT + ' (mêmes identifiants)');
});
