# IPTV webOS Player — implémentation (Spec V9 / V9.1, Plan Sprint 0→4)

App webOS TV (cible : webOS 5.0 entrée de gamme, Chromium 68) : imports **M3U +
XMLTV + Xtream Codes**, virtualisation TV, pipeline média NATIVE→MSE avec
watchdog, persistance Dexie v2 (table `vod`, règle DB-5).

## Statut d'exécution (vérifié dans cet environnement, 2026-09-09)

| Gate | Résultat |
|---|---|
| `npm ci`-style install (deps figées §2.1 : dexie 3.2.4, hls.js 1.4.14, webostvjs 1.2.4) | ✔ |
| `npm run build` (Vite 4.5.0, target chrome68, terser, workers IIFE, inlineDynamicImports) | ✔ 26 modules, 4 bundles (3 workers séparés + 1 chunk unique) |
| `npm test` (harnais maison `node:test`, **39 tests**) | ✔ 39/39 |
| `tools/syntax-gate.mjs src` (interdit `?.` `??` `.flat` `Object.fromEntries` `globalThis` nu…) | ✔ 20 fichiers |
| `tools/syntax-gate.mjs dist` (deps minifiées, occurrences sous garde tolérées et documentées) | ✔ 2 occurrences gardées (interop `typeof globalThis`, `typeof self.clients &&` de hls.js) |
| Build store `IPTV_PRODUCTION=true` (Q3) | ✔ 480.30 kB, bundle sans aucun `console.*` |
| Boot du build de production dans un vrai navigateur (chrome-headless-shell 153, CDP via `tools/browser-run.mjs`) | ✔ `#root` monté, 0 erreur console |
| **Smoke navigateur réel** (`dev/smoke.html` sur le serveur Vite : workers `?worker` réels, Dexie/IndexedDB réels, import 50 lignes + swap + filet §5.5) | ✔ **SMOKE PASS (8/8)** |
| **Harnais §9 en navigateur réel** (`tests/harness.html`, H1–H8 + test lourd H9) | ✔ **HARNESS PASS (9/9)** ; H9 : 20 000 lignes en 2,7 s, pire intervalle rAF 47 ms (budget ≤ 50 ms) |
| Qualification §11 T1–T4 sur webOS 5.0 (émulateur/TV) | ⏳ **non exécutable ici** — spécificités webOS (ServiceBridge, décodeur matériel, D-pad RC) + pré-requis bloquant Q2 du plan |

Couverture des fixtures §9 : `m3u-20000` (20 002 lignes exactes avec variantes),
`xmltv-644` (preuve de terminaison PROT-3/4), `xmltv-500-exact`, offsets ±HHMM,
dates-12, attrs (`>` quoté/quotes simples/ordre), CDATA+entités, coupe 7 Ko,
`duo-playlists` (non-purge croisée), PROT-6, abort à ~premier CHUNK, watermark
waiters, filet `worker.onerror`, `xtream-mock` (5 channels + 4 vod exacts,
`ACCOUNT_INFO.maxConnections=2`), `xtream-auth-fail` (zéro écriture), XP-4
(catégorie 503 ignorée), bascule de table sans CHUNK mixte, invariant §1.2-6
(≤ 19 nœuds sur 20 000 items), matrice média complète §7.1, cycle de vie §7.4
avec reprise + seek, politique §7.5.

## Écarts à la spec — tous justifiés et tracés

1. **`webostvjs` (Sprint 0, §3 corrigé V9.1)** : le paquet n'a aucun export ESM
   (bundle webpack qui pose `window.webOS` par effet de bord) → `import 'webostvjs';`
   + accès `window.webOS`. Découvert par le build Rollup, intégré à la spec (lignes
   §3 et §13 V9.1).
2. **PROT-5 à l'abort utilisateur (V9.1)** : `ImportController.abort()` ajoute
   `importId` à `DataManager.abortedImports` avant `ABORT_IMPORT` — sans ça, un
   CHUNK déjà en vol était écrit après l'annulation, en contradiction avec PROT-5.
   `PlaylistManager.abort()` solde `status:'failed'` + purge les lignes partielles
   (§9 attend « status: 'failed' » immédiatement ; le filet §5.5 reste la voie de
   rattrapage si l'app meurt avant).
3. **`xtream.worker` (implémentation de §6.5)** : l'attente d'ack est une promesse
   résolue par `CHUNK_COMMITTED` au lieu du polling `setInterval(16 ms)` du
   pseudo-code de référence — comportement identique, sans timer résiduel (esprit
   anti-timer-zombie V8). Protocole PROT-1…4 et messages strictement conformes.
4. **`fake-indexeddb` en devDependency uniquement** : les deps *livrées* restent
   figées à §2.1 ; ce paquet sert à exécuter le **vrai Dexie** headless (sinon les
   tests réimplémenteraient la sémantique indexée, ce qui ne prouverait rien —
   cf. §9 « invisibles au build »). Justification Q4 du plan : harness `node:test`
   zéro-dép de runtime, mapping `hls.js`/`webostvjs` par hooks ESM (`--import`).
5. **D-Pad de la vue chaînes** : FocusEngine est verbatim (§8.1) ; le guidage
   `scrollTop` du `VirtualList` (fenêtre recyclée) est pris en charge dans
   `src/app.js` (couche UI), comme §8.2 le prévoit (« l'UI notifie
   `setFocusables(...)` après chaque `_renderWindow()` significatif »).
6. **Validation `m3uUrl` élargie aux `blob:`** (`PlaylistManager.create()`) : la
   spec exige `http(s)` ; les harnais §9 servent leurs fixtures via `blob:` URL.
   Le garde-fou accepte `^(?:https?://|blob:)` — commentaire de code explicite
   (« http(s) pour le device ; blob: accepté pour les fixtures des harnais »).
   Sur le device, l'UI ne produit que des `http(s)`.
7. **Respiration des imports (§5.3, correction V9.1 appliquée au code)** : la
   respiration « attendre un `requestAnimationFrame` nu » gèle la file d'écriture
   quand le thread UI ne produit aucune frame (découvert au harness H9 headless) ;
   la course rAF/plafond 32 ms est désormais décrite en spec et implémentée à
   l'identique. Aucune divergence résiduelle — tracée au §13 pour l'historique.

8. **Workers inlinés (`?worker&inline`, bootstrap.js)** — en build dist, Vite 4 avec
   `base: './'` + script `type="module"` génère `new Worker(new URL(fichier,
   document.baseURI))` (car `document.currentScript` est `null` en contexte module) :
   les workers séparés de `dist/assets/` étaient donc cherchés à la racine du document
   → `ERR_FILE_NOT_FOUND` (découvert sur device de test, import compte Xtream en
   `file://`). Les trois workers sont inlinés (base64 → Blob → `createObjectURL`) :
   plus aucune résolution de chemin, identique en dev/build/device, fonctionne même
   en `file://` et sans CSP (§4 inchangé). Coût : +10,5 kB dans le chunk principal ;
   protocole §5.2, filet §5.8 et `workerFactory` inchangés. Validé en vrai navigateur
   sur le build dist : import Xtream réel (5 248 chaînes + 29 382 lignes VOD en DB) et
   fixture m3u 300 lignes exactes, console propre.

## Validation en navigateur réel (ajout post-plan)

`tools/browser-run.mjs` pilote **chrome-headless-shell** en CDP (pas de
Puppeteer : zéro dépendance livrée ; `ws` en devDependency d'outillage
seulement). Utilisation :

```bash
node tools/browser-run.mjs <url> '<expression de sonde>' <timeoutMs>
# le runner ouvre la page, polling de la sonde toutes les 500 ms,
# rend {url, result, console, chromeLog} ; exit 0 ssi verdict PASS non-FAIL.
node tools/browser-run.mjs "http://127.0.0.1:5173/dev/smoke.html" \
  'var t=(document.getElementById("status")||{}).textContent||""; (/SMOKE (PASS|FAIL)/.test(t) ? t : "")'
node tools/browser-run.mjs "http://127.0.0.1:5173/tests/harness.html" \
  'var t=(document.getElementById("status")||{}).textContent||""; (/HARNESS (PASS|FAIL)/.test(t) ? t : "")'
```

Les pages `dev/smoke.html` et `tests/harness.html` consomment le **vrai** build
Vite (`?worker`, `node_modules`, IndexedDB d'un navigateur réel), donc valident
ce que le harnais `node:test` ne peut pas : évaluation ESM sous Vite, cycle de
vie des workers, migrations Dexie réelles, `URL.createObjectURL`/fetch blob.
La variante 68 bits (Chromium 68 d'émulateur webOS) reste à couvrir par T1 ; le
gate statique `tools/syntax-gate.mjs` en tient lieu de barrière préventive.

## Outillage et publication — artefacts hors espace persisté (budget workspace)

Pour rester sous le budget du snapshot d'espace de travail, l'outillage lourd
n'est **pas persisté** ; il vit dans `/tmp` (éphémère entre sessions) et se
reconstitue ainsi :

- **chrome-headless-shell** (~261 Mo — exécutant des harnais navigateur) :
  ```bash
  mkdir -p /tmp/chrome-headless-shell/linux-153.0.8010.36
  cd /tmp/chrome-headless-shell/linux-153.0.8010.36
  curl -Ls https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.36/linux64/chrome-headless-shell-linux64.zip -o c.zip
  unzip -q c.zip && rm c.zip   # apt: libnss3 libasound2 libgbm1 libxkbcommon0 … (déjà posés dans l'image)
  ```
  `tools/browser-run.mjs` le découvre seul (`/tmp/chrome-headless-shell/…`), ou via `CHROME_BIN`.
- **dossier de publication `/tmp/deploy`** (site surge), 100 % régénérable :
  `IPTV_PRODUCTION=true npm run build` puis `mkdir -p /tmp/deploy && cp -r dist/* /tmp/deploy/` ;
  zip source : `zip -qr /tmp/deploy/iptv-webos-projet-complet.zip SPEC-IPTV-webOS-V6-FINAL.md IMPLEMENTATION-PLAN.md iptv-webos -x "iptv-webos/node_modules/*" -x "iptv-webos/chrome-headless-shell/*" -x "iptv-webos/dist/*"` ;
  dépôt git « dumb » : `git -C /home/user/gitserve/export/iptv-webos.git repack -qAd && git -C … update-server-info` puis copie dans `/tmp/deploy/git/iptv-webos.git` (+ `git bundle create` du même HEAD) ;
  pages web du dépôt : `node /home/user/gitserve/make-site.mjs` (lit le repo, écrit `/tmp/deploy/repo|raw`).
- **surge CLI** (`/tmp/surgetool`) : `npm i surge` ; pousser :
  `SURGE_LOGIN=… SURGE_TOKEN=… ./node_modules/.bin/surge /tmp/deploy --domain <domaine>`
  (identifiants et token dans `/home/user/.arena-deploy-*` — persistés, à sauvegarder).
- `node_modules/` du projet : hors snapshot mais reproductible à l'octet près : `npm ci`
  (deps figées §2.1 + devDeps fake-indexeddb/ws d'outillage uniquement).

## Lancer

```bash
npm install          # une fois
npm test             # 39 tests, ~14 s
npm run build        # dist/ packager-ready (+ public/manifest.json copié)
IPTV_PRODUCTION=true npm run build   # build store (drop_console)
npm run dev          # développement navigateur (les workers ?worker sont gérés par Vite)
# Test desktop du dist : servir en http (fetch cross-origin interdit
# en file://) — p. ex. `python -m http.server -d dist 8090` puis http://127.0.0.1:8090/
node tools/syntax-gate.mjs src && node tools/syntax-gate.mjs dist   # gate 68
npm run dev              # puis, autre terminal : smoke + harnais §9 en navigateur réel
node tools/browser-run.mjs "http://127.0.0.1:5173/dev/smoke.html" '…' 90000   # → SMOKE PASS
node tools/browser-run.mjs "http://127.0.0.1:5173/tests/harness.html" '…' 240000 # → HARNESS PASS
```

(Les sondes complètes sont dans la section « Validation en navigateur réel » ; le
runner attend chrome-headless-shell — voir `CHROME_BIN` ou l'auto-découverte
`chrome-headless-shell/linux-*/chrome-headless-shell-linux64/`.)

### Test sur simulateur / navigateur desktop : proxy de panneau (optionnel)

Certains panneaux Xtream protègent les segments `/hls/<session>/*.ts` par session
liée à des cookies et à l'origine de la requête : Chromium ≥ 80 (simulateurs webOS
récents, navigateurs desktop) **ne transmet pas les cookies cross-site** sur les
requêtes média/fetch (SameSite=Lax) → **403 Forbidden** sur les segments alors que
la ligne `STARTUP_INCOMPATIBILITY (…native <video> error event) → fallback
HLS_MSE` montre que la chaîne de l'app, elle, fonctionne (matrice §7.1). Le moteur
natif d'une vraie TV webOS est exempté de cette politique.

Un proxy de test sans dépendance rend le panneau same-origin (cookies, CORS,
redirects réécrits, UA outillée assainie) :

```bash
node tools/panel-proxy.mjs --target http://kdfgh.com:8080 --port 8091
# puis dans l'UI : Base Xtream = http://127.0.0.1:8091 (mêmes identifiants)
```

L'API (`player_api.php`), le playlist et les segments passent alors par le même
`127.0.0.1` → le navigateur les traite en 1re partie. Outil de dev uniquement :
hors `src/`, jamais bundlé, absent de l'IPK.

Packaging TV réel : `npm run build` puis `ares-package dist -o build` — `appinfo.json`
(verbatim §4, 11 propriétés) est copié de `public/` par Vite ; icônes placeholders
1×1 px **à remplacer avant soumission store**. NB : le nom du fichier est
`appinfo.json` (attendu par ares-package, cf. plan tâche 0.3) ; une version
intermédiaire du projet le livrait sous `manifest.json`, d'où l'erreur
« No meta file (ex. appinfo.json, services.json) » avec les CLI ≤ 5.x — corrigée
par renommage, contenu inchangé).

## Reste à faire (hors périmètre de cet environnement)

- Smoke test sur émulateur/TV webOS 5.0 : le noyau (SyntaxError §2.2, workers `?worker`,
  IndexedDB/Dexie, import+swap+filet) est **validé en Chromium réel** (voir section
  « Validation en navigateur réel ») ; reste la partie spécifique webOS : vraie chaîne
  UA/`window.webOS.deviceInfo` (V9.1), ServiceBridge/`fetch` TV, clavier RC.
- Qualification §11 T1–T4 signée (bloquant plan, question Q2).
- `urlResolver` de tokens (Sprint 2 tâche 2.4) : hook prévu dans
  `LifecycleAdapter`, brancher le rafraîchissement de token quand le backend le fournira.
- Écrans VOD/Search réels sur device (logique testée ; affichage TV à valider).

## Arborescence

Conforme à l'arbre gelé du plan (`SPEC-IPTV-webOS-V6-FINAL.md` ↔ `IMPLEMENTATION-PLAN.md`), dont :
`src/data/{db,DataManager,ImportController,m3u,epg,xtream}` · `src/media/{MediaAdapter,Watchdog,DualPlayerPolicy}` ·
`src/platform/{LifecycleAdapter,XtreamClient}` · `src/ui/{FocusEngine,VirtualList}` · `src/services/PlaylistManager` ·
`src/{bootstrap,app}.js` · `tests/` (harnais node + harness.html/harness-run.js §9 navigateur + fixtures générées) · `dev/smoke.{html,js}` (smoke Sprint 0) · `tools/{syntax-gate,browser-run}.mjs`.
