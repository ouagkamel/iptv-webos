# IPTV webOS Player — implémentation (V18 import optimisé, base V17.1)

App webOS TV (cible : webOS 5.0 entrée de gamme, Chromium 68) : imports **M3U +
XMLTV + Xtream Codes**, virtualisation TV, pipeline média NATIVE→MSE avec
watchdog, persistance Dexie v3 (vod, séries, cache de détail, catégories ; règles DB-5/DB-6/DB-7).

## Statut d'exécution (vérifié dans cet environnement, 2026-09-11)

| Gate | Résultat |
|---|---|
| `npm ci`-style install (deps figées §2.1 : dexie 3.2.4, hls.js 1.4.14, webostvjs 1.2.4) | ✔ |
| `npm run build` (Vite 4.5.0, target chrome68, terser, workers IIFE, inlineDynamicImports) | ✔ 31 modules transformés, bundle principal 530,03 kB minifié |
| `npm test` (harnais maison `node:test`, variantes de benchmark supprimées) | ✔ 81/81 |
| `tools/syntax-gate.mjs src` (interdit `?.` `??` `.flat` `Object.fromEntries` `globalThis` nu…) | ✔ 25 fichiers |
| `tools/syntax-gate.mjs dist` (deps minifiées, occurrences sous garde tolérées et documentées) | ✔ 2 occurrences gardées (interop `typeof globalThis`, `typeof self.clients &&` de hls.js) |
| Build store `IPTV_PRODUCTION=true` (Q3) | ✔ 526,01 kB, bundle sans aucun `console.*` |
| Boot du build de production dans un vrai navigateur (chrome-headless-shell 153, CDP via `tools/browser-run.mjs`) | ✔ `#root` monté, 0 erreur console |
| **Smoke navigateur réel** (`dev/smoke.html` sur le serveur Vite : workers `?worker` réels, Dexie/IndexedDB réels, import 50 lignes + swap + filet §5.5) | ✔ **SMOKE PASS (8/8)** |
| **Harnais §9 en navigateur réel** (`tests/harness.html`, H1–H8 + test lourd H9) | ✔ **HARNESS PASS (9/9)** ; H9 : 20 000 lignes en 2,7 s, pire intervalle rAF 47 ms (budget ≤ 50 ms) |
| **E2E télécommande / séries** (`bench/m5.mjs`, panel mock RTT 80 ms) | ✔ import + zap + play/pause + saisons/épisodes + Magic Remote |
| **UI import V18** | ⏳ à rejouer dans le navigateur réel : un seul bouton `Importer` playlist, import EPG séparé |
| Qualification §11 T1–T4 sur webOS 5.0 (émulateur/TV) | ⏳ **non exécutable ici** — spécificités webOS (ServiceBridge, décodeur matériel, D-pad RC) + pré-requis bloquant Q2 du plan |

Couverture des fixtures §9 : `m3u-20000` (20 002 lignes exactes avec variantes),
`xmltv-644` (preuve de terminaison PROT-3/4), `xmltv-500-exact`, offsets ±HHMM,
dates-12, attrs (`>` quoté/quotes simples/ordre), CDATA+entités, coupe 7 Ko,
`duo-playlists` (non-purge croisée + GC lazy), PROT-6, abort à ~premier CHUNK,
watermark waiters, filet `worker.onerror`, `xtream-mock` (5 channels + 4 vod exacts,
`ACCOUNT_INFO.maxConnections=2`), `xtream-auth-fail` (zéro écriture), XP-4
(catégorie 503 ignorée), bascule de table sans CHUNK mixte, deux lots en vol,
`bulkAdd` exclusif, objets Xtream compacts et import par défaut V18.

## Télécharger

- **Archive complète V17.1 (source + `dist/` prêt pour `ares-package`)** : release
  GitHub → https://github.com/ouagkamel/iptv-webos/releases ; téléchargement direct :
  https://github.com/ouagkamel/iptv-webos/releases/download/v17.1/iptv-webos-v17.1.zip
  (après publication). Code source seul : bouton « Download ZIP » de GitHub, ou
  `git clone https://github.com/ouagkamel/iptv-webos.git` puis `npm ci && npm run build`.
- Miroir de démonstration : https://iptv-webos-demo-ef07f8.surge.sh (canal secondaire ;
  GitHub reste le canal recommandé pour l'archive TV).

## Import par défaut V18

Les variantes de benchmark `Test import 1` à `Test import 5` ont été supprimées
de l’interface. Il n’existe plus qu’un bouton **Importer** par playlist ; il
utilise le profil de production défini dans `src/data/ImportProfiles.js` :

| Réglage | Valeur | Effet |
|---|---:|---|
| taille d’un lot | 2 000 lignes | zone de confort TV entre 1 000 et 2 500 |
| écriture | `bulkAdd` exclusivement | aucune vérification de remplacement sur un nouvel `importId` |
| lots en vol | 2 | chevauchement du mapping Worker et de l’écriture IndexedDB |
| respiration | 1 frame tous les 4 lots | pas de `setTimeout` fixe à chaque lot |
| catalogues Xtream | parallèle | live, VOD et séries sont demandés selon le chemin V10 |

Le `DataManager` sérialise toujours les écritures, mais le Worker peut préparer
le lot suivant pendant que le lot courant est écrit. Les ACK portent un
`chunkId`, ce qui protège contre les ACK tardifs ou dupliqués. Les objets envoyés
par `xtream.worker.js` sont réduits aux propriétés nécessaires à l’affichage et
à la lecture ; le fallback `JSON.stringify/parse` n’est pas activé, car il
ajouterait un aller-retour CPU inutile à ces objets déjà plats.

Le swap final ne supprime plus l’ancien catalogue dans la transaction de fin.
`activeImportId` est changé rapidement, `import-complete` est publié, puis une
GC différée supprime les anciennes lignes par lots de 500. Si l’application est
arrêtée avant cette GC, `bootMaintenance()` retrouve les lignes orphelines au
prochain démarrage.

## Quota de stockage après un import échoué

Après une erreur d'écriture, la V18 marque l'import `failed` et purge son
staging par petits lots sans toucher au catalogue actif. Lors d'un import réussi,
le swap est court : la GC des anciens imports est différée et sérialisée. Au
lancement suivant, `bootMaintenance()` nettoie les lignes devenues orphelines ;
les anciens `failed` laissés par une version précédente sont aussi nettoyés au
prochain nouvel essai. Si `STORAGE_QUOTA` persiste, la capacité locale est
réelement insuffisante pour conserver simultanément l'ancien catalogue et le
staging sécurisé : libérer les données du site/application puis relancer.

## Ordre serveur des listes et du zap (révision V13, règle DB-7)

Les listes **Chaînes / Films / Séries** et le zap ↑/↓ du lecteur suivent
l'**ordre du serveur** : rang de catégorie (`db.categories`), puis position
d'arrivée (`sortIdx` écrit par les workers sur chaque ligne), puis clé pour le
départage. L'ordre lexicographique des clés IndexedDB (« Canal 0-10 » avant
« Canal 0-2 ») n'est jamais observable — ni en mode catalogue global, ni en
repli par catégories, ni en M3U (ordre du fichier). Le tri est une fonction
pure (`src/services/ListOrder.js`) appliquée à la lecture par le
`PlaylistManager` — jamais dans les workers ni dans l'UI.

## Télécommande & navigation (révision V12)

- **Zap sans sortir du lecteur** : pendant une chaîne, ↑/↓ (aussi PROG−/PROG+
  412/414 et PageUp/Down) changent de chaîne directement dans la liste filtrée
  courante (circulaire). Sur un épisode : ↑/↓ = épisode précédent/suivant de
  la saison. 415/448/19 = pause/lecture, 413/Échap/Back = fermer, 417/419 =
  ±10 s (VOD/épisodes seulement), 457 = réafficher l'OSD, 402 = onglet
  Playlistes. Garde anti-répétition par type (mouvement 45 ms, zap 130 ms).
- **Séries en deux temps** : saison → épisode (panneau mono-saison : accès
  direct), retour ← / Échap / Back en pile LIFO.
- **Champs préservés** : les flèches ne sont jamais volées à la recherche ou
  aux sélecteurs ; Entrée dans la recherche lance le filtre ; l'activation des
  boutons au clavier (focus-activate → click) est réparée partout (overlays,
  formulaire). Clic Magic Remote actif sur les lignes de liste.
- Logique pure et testée : `src/ui/RemoteKeys.js` (table de classement,
  `stepIndex`/`pageIndex` circulaires, gate à horloge injectable).

## Séries & catégories serveur (révision V11)

- **Séries (Xtream uniquement)** : import `get_series` dans la table `series`
  (mêmes mode global + repli que V10, mêmes gardes mémoire) ; le détail
  `get_series_info` est **paresseux** (un appel à la première ouverture de la
  série, cache local `series_info` TTL 24 h, trois formes de panneaux normalisées
  `seasons`/`entries`/`episodes` Xtream réel (dictionnaire par saison, avec
  `episode_num`) ; lecture d'épisode par le même lecteur que la VOD
  (`{base}/series/{u}/{p}/{episode_id}.{ext}`). Un échec de détail n'affecte
  jamais l'import (« Réessayer » côté UI).
- **Catégories telles que définies par le serveur** : message additif
  `CATEGORIES` (worker → DataManager → table `categories`, **ordre du serveur
  conservé**, y compris en mode repli ; M3U = group-title dans l'ordre de
  première apparition). Chaque liste Chaînes / Films / Séries est précédée d'un
  sélecteur de catégorie (« Toutes les catégories » en tête) ; le filtre
  s'applique avant la recherche préfixe et le plafond de rendu.
- **DB v3 (additive)** : `series`, `series_info`, `categories` ; purge/swap
  bornés §5.3 étendus aux trois tables ; boot maintenance idem.

## Performance d'import (révision V10)

- **Xtream : catalogue global par défaut** — 1× `get_live_streams` + 1×
  `get_vod_streams` **sans** `category_id` + `Map` catégorie→nom locale (catégorie
  inconnue → « Autres »). Repli **obligatoire** sur la boucle par catégories V9 si
  l'appel global échoue (HTTP non-2xx, JSON invalide) ou si `Content-Length` >
  40 Mo (mémoire bornée par le catalogue, pas par la plus grosse catégorie).
  Mesuré (harnais headless, mock 900 catégories, RTT 80 ms, 23 400 lignes) :
  **74,4 s → 2,4 s** dans l'app réelle.
- **`CHUNK_ITEMS = 2000`** dans les trois workers, avec **deux CHUNK en vol** :
  le Worker continue le mapping pendant l'écriture IndexedDB du lot précédent.
  `DataManager` utilise `bulkAdd` exclusivement et respire une frame tous les
  quatre lots, au lieu d'attendre un délai fixe après chaque lot. Le watermark
  réseau M3U/XMLTV reste séparé et borné à quatre chunks texte.
- **Badge de progression** (`src/components/ImportBadge.js`, §9) : % de lignes
  si le worker a publié `IMPORT_META` (mode global), sinon % d'octets si
  `Content-Length` est connu (M3U/XMLTV), sinon barre indéterminée animée
  (repli par catégories). Événements `import-start` / `import-meta` /
  `import-progress` / `import-rows` **purement additifs** : retirer le badge ne
  peut pas régresser un import. Non interactif (jamais focusable), hors D-pad.

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

8. **Import V18** : les cinq variantes de benchmark et leurs boutons ont été
   retirés. Le chemin normal utilise `bulkAdd`, 2 000 lignes, deux lots en vol
   et une respiration périodique par frame. Le swap publie `import-complete`
   avant la GC lazy des anciens imports ; `bootMaintenance()` reste le filet de
   reprise après arrêt avant nettoyage.

9. **Workers inlinés (`?worker&inline`, bootstrap.js)** — en build dist, Vite 4 avec
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

### Revue simulateur n°2 : auto-annulation du fallback (corrigée en 38ed531)

Trace type observée au simulateur : `10.m3u8` 302→200 (médias, 759 o) puis la
requête **hls.js** de la playlist apparaissait « canceled » (0 o / 4 ms), suivie
de `STARTUP_INCOMPATIBILITY → fallback HLS_MSE` … puis d'un ERROR immédiat. Cause
interne à l'adaptateur, sans rapport avec le panneau : le `_teardownPlayback()`
du fallback (1) met un `MediaError` code 4 en file d'attente côté Chromium — livré
après l'`attachMedia()`, il était lu comme un échec du MSE naissant ; et (2) le
`play()` natif encore en vol était annulé par le vidage, son rejet
(`AbortError`/`NotSupportedError`) arrivait après le changement de moteur et
escaladait de même. Dans les deux cas le pipeline s'entretuait.

Correctif : en HLS_MSE **avant** `MANIFEST_PARSED`, une `error` code 4 sans buffer
est ignorée (c'est la trace du vidage) ; compteur de génération de tentative de
lecture (`_playGen`) — un rejet de `play()` dont la génération n'est plus courante
ne décrit plus aucune lecture et ne décide rien. Le xhr du fallback ne doit plus
apparaître « canceled 0 o » ; si le flux reste noir, l'erreur affichée est désormais
**nommée par hls.js** (réseau/media/auth) et décrit le panneau, non plus l'app.

### V16 : import plus lisible et playlist Xtream par défaut

Au premier lancement, la playlist Xtream de test est maintenant créée une seule
fois et sélectionnée automatiquement : il suffit de cliquer sur **Importer**.
Les identifiants sont compilés dans l'IPK pour cette commodité et ne doivent pas
être considérés comme secrets.

Avant le premier pourcentage, le badge affiche désormais les phases réelles :
connexion, catégories, téléchargement des catalogues, puis écriture des chaînes,
films et séries. Les catalogues globaux `get_live_streams`, `get_vod_streams` et
`get_series` sont récupérés en parallèle ; l'écriture reste dans l'ordre live →
VOD → séries et `IMPORT_META` conserve son total exact. Cela réduit l'attente
initiale et permet de distinguer un temps réseau/JSON d'un temps IndexedDB.

### V15 : réponse `get_series_info` Xtream réelle

Certains panneaux ne renvoient pas `seasons` ni `entries`, mais la forme
standard Xtream : `episodes: { "1": [ ... ], "2": [ ... ] }`. Le normaliseur
prend désormais cette forme en charge, utilise `episode_num` pour afficher
l'épisode, conserve `id` pour construire l'URL `/series/`, et garde les numéros
de saison fournis par le serveur. La recette comprend cette forme, invalide les anciens caches `series_info`
(`formatVersion`), et totalise **76/76 tests**.

### V14 : démarrage des chaînes FHD (fenêtre d'inactivité, 2026-09-10)

La trace TV fournie montre une playlist `.m3u8` en `200`/`302`, puis une requête
`.ts` d'environ **3 Mo** : ce n'est pas un échec réseau. L'ancien délai dur de
10 000 ms pouvait cependant basculer/arrêter la lecture avant la première image.
Le contrat V14 de `MediaAdapter` est désormais :

- 10 s = **fenêtre sans progression**, pas plafond total ; les événements natifs
  (`loadedmetadata`, `loadeddata`, `progress`, `canplay`, `timeupdate`) la réarment ;
- `networkState === 2` (`NETWORK_LOADING`) côté natif et `MANIFEST_LOADING` /
  `LEVEL_LOADING` / `FRAG_LOADING` côté hls.js marquent une requête active : le
  minuteur est repoussé au lieu de produire un faux `STARTUP_FAILURE` ;
- `MANIFEST_LOADED`, `MANIFEST_PARSED`, `LEVEL_LOADED`, `FRAG_LOADED`,
  `FRAG_BUFFERED` et `BUFFER_APPENDED` sont aussi des marqueurs de progression ;
- plafond absolu à **45 s** depuis `play()` jusqu'à la première image, jamais
  réarmé par les marqueurs ni par le fallback NATIVE → HLS_MSE. Un flux réellement
  silencieux conserve le comportement de fallback/erreur ; un flux qui marque de
  l'activité sans afficher finit avec `STARTUP_TIMEOUT_CAP`, au lieu de rester
  bloqué indéfiniment ;
- les callbacks hls.js vérifient l'instance et le `requestId`, afin qu'un ancien
  zapping ne repousse pas le délai du nouveau flux.

### Device réel : échelle de diagnostic d'amorçage à l'écran

Un écran noir au démarrage sur TV réelle n'était pas lisible sans ares-inspect.
L'app affiche désormais seule une étiquette d'étape en bas à gauche (visible aussi
en saveur production — elle n'utilise pas la console) : « chargement module… » →
« détection capacités… » → « base locale (IndexedDB) : ouverture… » →
« maintenance §5.5/§5.6… » → disparition quand l'UI est prête. Cas d'échec :
exception au chargement → « ERREUR: … » en rouge ; import du bundle jamais exécuté
→ message rouge après 5 s ; `db.open()` bloqué (IDB indisponible ou connexion
résiduelle d'une instance non fermée sur `file://`) → erreur explicite après 8 s
au lieu d'un blocage muet. En cas de TV noire : lire l'étiquette figée ET, si
possible, coller la sortie de `ares-inspect --target <ip-tv>` (page
`com.iptv.webos.player`) ou `ares-log --device <ip-tv> -a com.iptv.webos.player`.

**Cause tranchée au premier déploiement TV (message « module non exécuté ») :**
sur la TV, l'app installée tourne sur une origine `file://` où `<script
type="module">` est refusé (politique CORS du moteur) — le simulateur sert en
`http://localhost` et ne peut pas le révéler. Le bundle étant déjà IIFE (§2.2,
sans `import.meta`), le build réécrit la balise en chargement **classique +
`defer`** (plugin `iptv-device-classic-script` dans `vite.config.js` ; sémantique
d'exécution identique). Reproduit et vérifié en headless `file://` sans flag :
variante module → même message rouge que la TV, variante classique → UI prête.

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

Conforme à l'arbre gelé du plan (`SPEC-IPTV-webOS-V6-FINAL.md` ↔ `IMPLEMENTATION-PLAN.md`, révision V17), dont :
`src/data/{db,DataManager,ImportController,m3u,epg,xtream}` · `src/media/{MediaAdapter,Watchdog,DualPlayerPolicy}` ·
`src/platform/{LifecycleAdapter,XtreamClient}` · `src/ui/{FocusEngine,VirtualList}` · `src/services/PlaylistManager` ·
`src/{bootstrap,app}.js` · `tests/` (harnais node + harness.html/harness-run.js §9 navigateur + fixtures générées) · `dev/smoke.{html,js}` (smoke Sprint 0) · `tools/{syntax-gate,browser-run}.mjs`.
