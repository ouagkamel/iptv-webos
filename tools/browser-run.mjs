// tools/browser-run.mjs — pilote chrome-headless-shell via CDP pour exécuter les
// pages de harnais RÉELLES (dev/smoke.html, tests/harness.html) et attendre la
// fin effective des tests (le dump-dom ne sait pas attendre un module async).
// Usage : node tools/browser-run.mjs <url> <exprProbe> <timeoutMs>
// exprProbe : expression JS évaluée en boucle ; truthy → capturée, retournée.
// Sortie : JSON du résultat + code d'exit 0 si la chaîne 'PASS' est présente.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const CHROME = process.env.CHROME_BIN || (() => {
  // Bases cherchées : locale au projet, puis /tmp (l'outillage navigateur est hors de
  // l'espace persisté pour tenir le budget du workspace — voir README § Outillage).
  const bases = ['chrome-headless-shell', '/tmp/chrome-headless-shell',
                 '/home/user/iptv-webos/chrome-headless-shell'];
  for (let b = 0; b < bases.length; b++) {
    try {
      const dirs = fs.readdirSync(bases[b]).filter(function (n) { return n.charAt(0) !== '.'; });
      for (let i = 0; i < dirs.length; i++) {
        const p = bases[b] + '/' + dirs[i] + '/chrome-headless-shell-linux64/chrome-headless-shell';
        if (fs.existsSync(p)) return p;
      }
    } catch (e) { /* base absente : on continue */ }
  }
  return null;
})();
if (!CHROME) { console.error('chrome-headless-shell introuvable (CHROME_BIN ?)'); process.exit(2); }

const url = process.argv[2];
const probe = process.argv[3] || 'document.getElementById("status") && document.getElementById("status").textContent';
const timeoutMs = parseInt(process.argv[4] || '90000', 10);
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--remote-debugging-port=' + PORT
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); if (chromeErr.length > 4000) chromeErr = chromeErr.slice(-4000); });

function findWsUrl() {
  return new Promise(function (resolve, reject) {
    const t0 = Date.now();
    let opened = false;
    (function poll() {
      fetch('http://127.0.0.1:' + PORT + '/json/list').then(function (r) { return r.json(); })
        .then(function (list) {
          const page = list.filter(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; })[0];
          if (page) return resolve(page.webSocketDebuggerUrl);
          if (!opened) {
            opened = true; // ouvre la target nous-même (le shell démarre sans onglet)
            fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
              .catch(function () { /* target peut arriver via list quand même */ });
          }
          if (Date.now() - t0 > 15000) return reject(new Error('CDP introuvable'));
          setTimeout(poll, 250);
        })
        .catch(function () {
          if (Date.now() - t0 > 15000) return reject(new Error('CDP injoignable'));
          setTimeout(poll, 250);
        });
    })();
  });
}

let mid = 0;
const pending = new Map();
function send(ws, method, params) {
  return new Promise(function (resolve, reject) {
    const id = ++mid;
    pending.set(id, { resolve: resolve, reject: reject });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

const consoleLines = [];
async function main() {
  const wsUrl = await findWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise(function (res, rej) { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', function (raw) {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const parts = (msg.params.args || []).map(function (a) { return a.value != null ? String(a.value) : (a.description || a.type); });
      consoleLines.push('[' + msg.params.type + '] ' + parts.join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleLines.push('[pageerror] ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
  });
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.enable');
  // Ne naviguer que si la target n'a pas encore la bonne URL (le /json/new l'a déjà lancée)
  try {
    const cur = await send(ws, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const href = cur && cur.result && cur.result.value;
    if (!href || href === 'about:blank' || url.indexOf(href) !== 0 || href.indexOf('/json/new') === -1 && href !== url) {
      if (href !== url) await send(ws, 'Page.navigate', { url: url });
    }
  } catch (eNav) { await send(ws, 'Page.navigate', { url: url }); }

  const t0 = Date.now();
  let captured = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await send(ws, 'Runtime.evaluate', {
        expression: '(function(){ try { var v = eval(' + JSON.stringify(probe) + '); return (v === "" || v == null) ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { return "PROBE_ERR:" + e.message; } })()',
        returnByValue: true
      });
      const val = r && r.result && r.result.value;
      if (val && val.indexOf('PROBE_ERR:') !== 0) { captured = val; break; }
      if (val && val.indexOf('PROBE_ERR:') === 0) { console.error(val); }
    } catch (e) { /* eval en cours de navigation */ }
    await new Promise(function (r2) { setTimeout(r2, 500); });
  }

  console.log(JSON.stringify({
    url: url,
    result: captured,
    console: consoleLines.slice(-25),
    chromeLog: chromeErr ? chromeErr.slice(-400) : ''
  }, null, 1));

  ws.close();
  chrome.kill('SIGKILL');
  const ok = captured && /PASS/.test(captured) && !/FAIL/.test(captured);
  process.exit(ok ? 0 : 1);
}

main().catch(function (err) {
  console.error('RUNNER:', err.message, '\nchrome tail:', chromeErr.slice(-600));
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(2);
});
