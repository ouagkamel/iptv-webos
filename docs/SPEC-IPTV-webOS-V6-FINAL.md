# SPÉCIFICATION TECHNIQUE D'EXÉCUTION & ARCHITECTURE — V17.1 (récupération après quota de stockage)

**Application IPTV / VOD / Live sur LG webOS — Baseline : webOS 5.0 / Chromium 68**

Cette version consolide les itérations V3 → V5 et intègre les corrections issues de la revue externe de la V6 (voir §13, matrice de traçabilité) : détection de version SDK, parsing XMLTV à frontières de chunks et balises robustes, backpressure de bout en bout **dont le composant réseau désormais fourni en code** (§5.8), purge bornée par playlist, fin de flux sans deadlock, stratégie de clés IndexedDB, fallback média complet avec reconnexion intra-moteur rétablie, reprise après veille, virtualisation réelle, activation Entrée/OK, et wiring d'événements conforme aux invariants.

---

## 1. Directives Agent IA & Protocole d'Alerte Multi-Niveau

**RÈGLE D'EXÉCUTION PRINCIPALE :** l'agent IA agit comme un développeur senior exécutant une feuille de route stricte. Il respecte l'architecture, la stack, le nommage et la découpe du projet sans introduire de frameworks tiers ni de refactorisations non demandées.

### 1.1 Protocole d'Alerte Technique

**NIVEAU 1 : BLOCKING (interruption de génération)**
- Triggers : incompatibilité matérielle absolue avec Chromium 68 ; fuite mémoire système avérée ; absence d'API critique sans fallback ; schéma ou parser risquant de corrompre les données (ex. frontière de chunk XML non gérée, purge cross-playlist, protocole d'import sans signal de terminaison).
- Action : interrompre la génération du composant, notifier la cause bloquante, attendre la décision humaine.

**NIVEAU 2 : WARNING (poursuite avec hypothèse documentée)**
- Triggers : variante non standard XMLTV/M3U ; header CORS manquant en environnement local ; comportement UI cosmétique non spécifié ; pluralité de titres `<title lang>` (politique retenue : **premier titre**, cf. note §6.4).
- Action : documenter l'hypothèse dans un commentaire d'en-tête du module et poursuivre.

### 1.2 Invariants de Robustesse & Sécurité

1. **Propriété Unique de l'Erreur** — chaque pipeline (réseau, parsing, IndexedDB, média) possède une seule voie terminale de traitement des exceptions. Pas de double `try/catch` + `.catch()` sur la même promesse. Les handlers globaux (`onerror`, `unhandledrejection`) sont des filets de dernier recours, jamais une voie nominale.
2. **Idempotence Guardée** — tout composant exposant `destroy()` protège son exécution par `this._destroyed`. **Sans exception**, y compris `MediaAdapter`, `LifecycleAdapter`, `FocusEngine`, `VirtualList`, `DataManager`.
3. **Protection XSS Stricte** — interdiction absolue d'`innerHTML` pour les données issues des flux tiers (M3U/XMLTV). Rendu exclusivement via `textContent` / `createElement` / attributs validés.
4. **Listeners Nommés & Liés** — tout `addEventListener` utilise une référence stockée (`this.boundX = this.onX.bind(this)`), retirable par le `destroy()` correspondant. **Interdiction des closures anonymes** dans les enregistrements d'événements persistants.
5. **Continuité Architecturale** — machine d'état média à passage unique (NATIVE → HLS_MSE → ERROR), libération du VPU sur `visibilitychange` **avec sauvegarde/restauration de session**, FocusEngine à hystérésis 5 px, protocole de qualification sur TV réelle : tous strictement obligatoires.
6. **Bornage Matériel UI** — `VirtualList` ne matérialise jamais plus de `⌈viewportHauteur / hauteurLigne⌉ + 2 × overscan + 1` nœuds DOM, quelle que soit la taille du catalogue.

### 1.3 Pattern de Composant de Base

```javascript
// src/core/BaseComponent.js
export class BaseComponent {
  constructor() {
    this._destroyed = false;
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
  }

  mount(parent) {
    if (this._destroyed) return;
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  handleKeyDown(event) {
    // À surcharger par les classes filles
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener('keydown', this.boundOnKeyDown);
  }
}
```

---

## 2. Stack Technique, Configuration Vite & Bundling Workers

### 2.1 Dépendances Figées (package.json)

```json
{
  "name": "iptv-webos-player",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "package": "ares-package dist -o build"
  },
  "dependencies": {
    "dexie": "3.2.4",
    "hls.js": "1.4.14",
    "webostvjs": "1.2.4"
  },
  "devDependencies": {
    "terser": "5.24.0",
    "vite": "4.5.0"
  }
}
```

Build CI : `npm ci` **exclusivement**. `drop_console: false` est une exigence de débogage terrain (`ares-inspect`) ; le passage à `true` en build store se fera via une variable d'environnement au Sprint 4 (WARNING documenté, non bloquant).

### 2.2 Configuration du Bundler (vite.config.js)

```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: {
    format: 'iife'           // Workers compatibles Chromium 68, sans ESM-in-worker
  },
  build: {
    target: 'chrome68',      // Transpilation esbuild du code applicatif
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Requis pour ares-inspect
        ecma: 6
      }
    },
    rollupOptions: {
      output: {
        format: 'iife',              // Rollup interdit le code-splitting en IIFE…
        inlineDynamicImports: true   // …donc tout import() dynamique est inliné (exigé)
      }
    }
  }
});
```

**Obligation Sprint 0 — smoke test :** le bundle final est chargé sur émulateur webOS 5.0 (ou Chrome 68 headless). Ce test vérifie également que les distributions pré-compilées de `dexie@3.2.4` et `hls.js@1.4.14` ne contiennent ni syntaxe post-68 (`?.`, `??`, class fields) ni API absente de Chromium 68 (ex. `Array.prototype.flat` = Chrome 69, `Object.fromEntries` = Chrome 73). Un `SyntaxError` minifié en production est quasi-indebuggable : ce test est la seule barrière.

---

## 3. Matrice de Détection des Capacités

La version webOS **n'est pas présente dans le User-Agent** (`Web0S; Linux/SmartTV … Chrome/68 … WebAppManager` ne contient aucun token `WebOS/X.Y`). Détection exclusivement via le SDK LG `webOS.deviceInfo()` (`info.sdkVersion` = version plateforme, ex. `"5.0.0"` — à ne pas confondre avec `info.version`, qui est la version du firmware TV). Garde-fou temporel de 1000 ms pour les exécutions hors WebAppManager, et double chemin d'accès (import npm / global) pour couvrir l'interop du package `webostvjs`.

```javascript
// src/utils/CapabilityDetector.js
import webOS from 'webostvjs';

export const Capabilities = {
  hasWorker: typeof Worker !== 'undefined',
  hasFetch: typeof fetch === 'function',
  hasReadableStream: typeof ReadableStream !== 'undefined',
  hasTextDecoder: typeof TextDecoder !== 'undefined',
  hasIndexedDB: typeof indexedDB !== 'undefined',
  hasMSE: typeof window.MediaSource !== 'undefined' && typeof window.SourceBuffer !== 'undefined',

  async detectAll() {
    if (!this.hasIndexedDB || !this.hasWorker) {
      throw new Error('BLOCKING: Environnement webOS non conforme (IndexedDB ou Worker manquant).');
    }

    const baselineVersion = { major: 5, minor: 0, patch: 0 };
    const baselineModel = '';

    const fetchDeviceInfo = new Promise((resolve) => {
      const sdkObj = (typeof window !== 'undefined' && window.webOS) ? window.webOS : webOS;
      if (sdkObj && typeof sdkObj.deviceInfo === 'function') {
        sdkObj.deviceInfo((info) => {
          if (info && info.sdkVersion) {
            const parts = String(info.sdkVersion).split('.').map(n => parseInt(n, 10) || 0);
            resolve({
              version: { major: parts[0] || 5, minor: parts[1] || 0, patch: parts[2] || 0 },
              modelName: info.modelName || ''
            });
          } else {
            resolve({ version: baselineVersion, modelName: baselineModel });
          }
        });
      } else {
        resolve({ version: baselineVersion, modelName: baselineModel });
      }
    });

    // Jamais de bootstrap figé : si le SDK ne répond pas (dev browser, émulateur), baseline 5.0
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ version: baselineVersion, modelName: baselineModel }), 1000)
    );

    const device = await Promise.race([fetchDeviceInfo, timeout]);
    return this._buildCapabilityReport(device);
  },

  _buildCapabilityReport(device) {
    return {
      webosVersion: device.version,          // Tuple {major, minor, patch} : comparaison par major
      modelName: device.modelName,           // Alimente l'allowlist Dual Player (§7.4)
      canStreamFetch: this.hasFetch && this.hasReadableStream && this.hasTextDecoder,
      canUseMSE: this.hasMSE,
      isWebOS6OrHigher: device.version.major >= 6
    };
  }
};
```

**Ordre de bootstrap (`src/bootstrap.js`) :** `Capabilities.detectAll()` → ouverture Dexie → procédure de reprise sur crash (§5.5) → purge EPG expirée (§5.6) → câblage du filet `worker.onerror` → `failImport(importController.currentImportId, …)` (§5.8) → init UI. Chaque étape journalisée (visible via `ares-inspect`).

> **Correction V9.1 (vérifiée au build Sprint 0) :** le paquet `webostvjs@1.2.4` (`main: webOSTV.js`) est un bundle webpack qui attache **`window.webOS` par effet de bord** et **n'exporte rien en ESM** — `import webOS from 'webostvjs'` échoue au bundling Rollup (« "default" is not exported »). Le code de référence devient : `import 'webostvjs';` (pur effet de bord) + accès unique `window.webOS` (le double chemin npm/global se réduit au chemin global, ce que le paquet impose réellement). La garde `deviceInfo.sdkVersion` et le timeout 1000 ms sont inchangés.

---

## 4. Configuration Vite & Manifeste

Voir §2.2 pour Vite. Manifeste store-ready :

```json
{
  "id": "com.iptv.webos.player",
  "version": "1.0.0",
  "vendor": "IPTV Dev Team",
  "type": "web",
  "main": "index.html",
  "title": "IPTV Player Pro",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "requiredMinOSVersion": "5.0.0",
  "resolution": "1920x1080",
  "handlesPageVisibility": true,
  "disableBackHistoryAPI": true,
  "bgColor": "#000000"
}
```

---

## 5. Architecture de Données — IndexedDB, Protocole d'Import, DataManager

### 5.1 Schéma Dexie & Stratégie de Clés Primaires (actée)

```javascript
// src/data/db.js
import Dexie from 'dexie';

export const db = new Dexie('IPTVDatabase');

db.version(1).stores({
  playlists: '++id, name, activeImportId, activeEpgImportId, updatedAt',
  imports:   '++id, playlistId, kind, status, createdAt',
  channels:  'id, importId, [importId+groupName], channelId, searchName',
  epg:       'id, [importId+channelId+startTime], importId, stopTime'
});

// v2 (amendement Xtream, §6.5) : table VOD dédiée — migration additive seule,
// jamais de modification destructive des stores v1 (Dexie gère l'upgrade).
db.version(2).stores({
  vod: 'id, importId, [importId+groupName], searchName'
});

// v3 (révision V11, §6.6/§6.4) : séries + cache paresseux + catégories serveur.
// Toujours additive seule ; aucune réécriture des stores v1/v2.
db.version(3).stores({
  series:      'id, importId, [importId+groupName], searchName', // mêmes index que vod
  series_info: 'id, importId',                                   // détail lazy, TTL 24 h
  categories:  '++cid, importId, [importId+kind]'                // ordre serveur conservé
});
```

**Règle DB-5 (Xtream) :** la VOD Xtream vit dans `vod` (jamais dans `channels`) ; clés applicatives `id = importId + ':' + xtreamStreamId` ; index identiques en esprit à `channels` (pagination par catégorie, recherche). Un import `kind: 'playlist'` issu d'Xtream écrit **channels (live) ET vod (films)** — la purge bornée §5.3 couvre les deux tables.

**Règle DB-7 (V13 — ordre d’affichage) :** les tables IndexedDB sont lues triées par clé primaire (`importId:stream_id`, ordre **lexicographique**) — jamais cet ordre ne doit atteindre l’utilisateur. Les listes (Chaînes, Films, Séries) **et le zap du lecteur** sont rendus dans l’ordre serveur : `rang de catégorie` (index dans `db.categories`), puis `sortIdx` (position d’arrivée du worker, persistée sur chaque ligne), puis `id` pour départage déterministe. Les groupes absents du serveur vont en fin, entre eux par `sortIdx`. Le tri vit dans la **couche lecture** (`src/services/ListOrder.js`, fonction pure ; `PlaylistManager.channels/vod/series` l’appliquent), pas dans les workers ni dans `db.js` — les workers ne font qu’écrire des lignes ordonnées par `sortIdx`, l’UI n’a pas à recompter.

**Règle DB-6 (V11 — séries & catégories) :** les séries Xtream vivent dans `series` (jamais dans `vod` ni `channels`) ; clé `id = importId + ':' + series_id`, champ `seriesId` brut conservé pour l'appel de détail. Le détail (`get_series_info`) n'est **jamais importé en masse** : table `series_info`, une ligne par série, écrite à la **première ouverture** de la série (cache TTL 24 h, id = `series.id`). `categories` porte les catégories **telles que définies par le serveur** (ordre d'origine conservé, `sort` = index serveur) — c'est la source des sélecteurs de parcours des trois listes ; pour le M3U, « serveur » = la playlist elle-même (group-title, ordre de première apparition). La purge bornée §5.3 d'un import `kind:'playlist'` Xtream couvre **channels, vod, series, series_info ET categories** de cette playlist ; le M3U écrit `categories(kind:'live')` en plus de `channels`.

**Règle de clés (invariant DB-1) — qui génère quoi :**
- `playlists.id`, `imports.id` : auto-incrémentés (`++id`), créés une seule fois via la couche applicative.
- `channels.id` : **chaîne applicative déterministe `${importId}:${seq}`**, générée par le worker à l'émission de chaque item (`seq` = compteur incrémental dans le fichier). Ce schéma rend `bulkPut` idempotent (un re-téléchargement recrée les mêmes clés → écrasement, pas de doublons).
- `epg.id` : **chaîne applicative `${importId}:${channelId}:${startTime}`** — déduplication naturelle des programmes identiques réémis lors d'un refresh EPG.

**Règle DB-2 — index :** `[importId+groupName]` sert la pagination par groupe ; `searchName` sert la recherche (`startsWith`) ; `[importId+channelId+startTime]` sert la requête EPG chronologique (`between([imp, ch, t0], [imp, ch, t1)])`) ; `stopTime` (seul) sert la purge d'expiration. `logo` et `streamUrl` ne sont **jamais indexés** (coût d'écriture et disque sans cas d'usage).

**Règle DB-3 — normalisation recherche :** `searchName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')` — calculé côté worker.

**Règle DB-4 — séparation des types d'import :** `imports.kind ∈ { 'playlist', 'epg' }`. Un import de playlist écrit dans `channels` et met à jour `playlists.activeImportId` ; un import EPG écrit dans `epg` et met à jour `playlists.activeEpgImportId`. La purge d'un type ne touche **jamais** la table de l'autre (cf. §5.4).

### 5.2 Protocole d'Import Commun (workers M3U, EPG et Xtream)

Pour M3U/EPG, `CHUNK_ITEMS` reste fixé à 2 000. Pour Xtream V17, le même
protocole accepte une taille choisie par le profil (2 000, 4 000 ou 8 000 dans
l'UI), sans jamais autoriser plus d'un lot en vol. Les champs `writeMode` et
`yieldMs` sont optionnels sur `CHUNK` et ne sont émis que par le worker Xtream.

```
Main Thread                              Worker
    │  INIT_IMPORT {importId, playlistId, kind[, profile]} ▶
    │                                            │  (état interne réinitialisé)
    │  PARSE_CHUNK {importId, chunk}   ────────▶ │  parsing + accumulation (M3U/EPG)
    │  ◀────────  CHUNK_PARSED {importId}        │  (ack de parsing : pilotage réseau, §5.7)
    │  ◀────────  CHUNK {importId, items, targetTable[, writeMode, yieldMs]} │  lot suspendu
    │  bulkPut (ou bulkAdd de diagnostic Xtream) → respiration UI
    │  CHUNK_COMMITTED {importId}  ────────────▶ │  worker reprend
    │  …                                         │
    │  END_OF_STREAM {importId}  ──────────────▶ │  flush forcé résiduel
    │  ◀────────  CHUNK (résidus) × n            │  drainé par acks jusqu'à vide
    │  ◀────────  COMPLETE {playlistId, importId}│  émis quand file vide + dernier ack reçu
    │  swap atomique + purge bornée (§5.4)       │
Erreur DB en cours de route :
    │  ABORT_IMPORT {importId} ────────────────▶ │  worker vide ses tampons
    │  ack résiduel des CHUNK déjà en vol (sans écriture)
```

**Invariants du protocole :**
- PROT-1 : le worker n'émet qu'un seul `CHUNK` en vol à la fois (`isWaitingForAck`).
- PROT-2 : tout `CHUNK_COMMITTED` dont l'`importId` ≠ import courant est ignoré (ack tardif d'un import avorté).
- PROT-3 : `COMPLETE` n'est émis que si `isStreamEnded ∧ ¬isWaitingForAck ∧ pendingItems.length === 0`.
- PROT-4 : **les restes partiels (< CHUNK_ITEMS) sont drainables après chaque ack une fois le flux terminé** — le handler d'ack force le flush avec l'état `isStreamEnded`. *(C'est la correction du deadlock de fin de flux : sans cette règle, tout import dont le total résiduel après dernier lot plein est < CHUNK_ITEMS ne termine jamais. V10 : `CHUNK_ITEMS = 2000` par défaut — V17 autorise 2 000/4 000/8 000 pour Xtream, la sémantique PROT-1 « un seul CHUNK en vol » étant **inchangée** ; gain mesuré : coût fixe d'acquittement/respiration ÷4, cf. annexe perf V10.)*
- PROT-5 : en cas d'`ABORT_IMPORT`, le main thread continue d'acquitter (`CHUNK_COMMITTED`) les lots déjà reçus **sans les écrire**, afin de ne jamais laisser le worker suspendu — l'import est marqué `status: 'failed'`.
- PROT-6 : **un seul import en vol par worker** (son état interne est singleton). Un second déclenchement est rejeté par l'ImportController (événement `import-busy`, promesse rejetée). L'UI désactive le contrôle d'import pendant toute la durée de l'opération.

### 5.3 DataManager (file sérialisée, respiration, erreur terminale sans rejet secondaire)

V17 ajoute deux métadonnées facultatives au message `CHUNK`. `writeMode: 'put'`
ou son absence sélectionne `bulkPut`, idempotent et réglage normal ;
`writeMode: 'add'` sélectionne `bulkAdd` uniquement pour le profil diagnostique Xtream 4. Les deux modes passent par la même file sérialisée, le même compteur
`import-rows`, la même respiration (`yieldMs`) et le même acquittement. Une
exception `bulkAdd` suit `failImport` : `status: 'failed'`, abort du worker et
aucun swap. `yieldMs` est borné par le worker à 0–64 ms et retombe à 32 ms si
invalide. En V17.1, toute erreur terminale de DB, notamment
`QuotaExceededError`, purge immédiatement les lignes de staging identifiées par
l'`importId` échoué, sans toucher à l'`importId` actif. Le prochain lancement
purge également les reliquats `failed` laissés par une version antérieure avant
d'ajouter un nouvel import. Le quota ne peut donc plus grossir par accumulation
d'essais échoués ; si le couple « import actif + nouvel import de staging »
dépasse malgré tout la capacité du téléviseur, l'import est refusé, l'ancien
catalogue reste intact et l'UI affiche `STORAGE_QUOTA`. Le code du dépôt est
normatif pour ce delta V17 (l’extrait ci-dessous résume la voie d’écriture) :

```javascript
// src/data/DataManager.js
import { db } from './db.js';

export class DataManager {
  constructor(worker, targetTableDefault) {
    this.worker = worker;
    this.targetTableDefault = targetTableDefault || 'channels';
    this.processingQueue = Promise.resolve();
    this.abortedImports = new Set();
    this.auxListeners = [];          // routage des signaux annexes (CHUNK_PARSED → §5.8)
    this._destroyed = false;
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
  }

  handleWorkerMessage(event) {
    const data = event.data;
    this.processingQueue = this.processingQueue.then(() => {
      if (this._destroyed) return undefined;
      if (data.type === 'CHUNK') return this._processChunk(data);
      if (data.type === 'COMPLETE') return this._processComplete(data);
      if (data.type === 'ERROR') {
        // Erreur terminale émise par le worker (ex. XTREAM_AUTH_FAILED §6.5)
        this.failImport(data.importId != null ? data.importId : null, new Error(data.message || 'worker ERROR'));
        return undefined;
      }
      this._routeAux(data); // CHUNK_PARSED / ACCOUNT_INFO et signaux annexes (§5.8, §6.5)
      return undefined;
    }).catch((err) => {
      this._handleTerminalError(err, data); // voie terminale UNIQUE — ne rejette jamais
    });
  }

  _handleTerminalError(err, data) {
    this.failImport(data && data.importId != null ? data.importId : null, err);
  }

  /**
   * Voie terminale d'import UNIQUE — appelée par le catch de la file ET par le
   * filet worker.onerror du bootstrap (qui injecte explicitement l'importId
   * courant, cf. §3 et §5.8). Ne rejette jamais : tout échec secondaire est
   * confiné localement (invariant §1.2-1).
   */
  failImport(importId, err) {
    console.error('DataManager fatal:', err);
    if (importId == null) {
      // Crash worker hors contexte d'import connu : journalisation via filet global
      window.dispatchEvent(new CustomEvent('worker-error', {
        detail: { message: String((err && err.message) || err) }
      }));
      return;
    }
    this.abortedImports.add(importId);
    try {
      this.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId });
    } catch (e1) { /* worker déjà mort (crash) : message orphelin toléré */ }
    try {
      db.imports.update(importId, { status: 'failed', error: String((err && err.message) || err) })
        .catch((e2) => { console.error('DataManager: marquage failed impossible:', e2); });
    } catch (e3) { /* DB injoignable (quota/corruption) : déjà journalisé */ }
    window.dispatchEvent(new CustomEvent('import-error', {
      detail: { importId: importId, message: String((err && err.message) || err) }
    }));
  }

  // Routage des signaux annexes vers le régulateur réseau (§5.8).
  // Le DataManager reste propriétaire unique de worker.onmessage.
  addAuxListener(fn) {
    if (typeof fn === 'function') this.auxListeners.push(fn);
  }

  removeAuxListener(fn) {
    const i = this.auxListeners.indexOf(fn);
    if (i !== -1) this.auxListeners.splice(i, 1);
  }

  _routeAux(data) {
    for (let i = 0; i < this.auxListeners.length; i++) {
      try { this.auxListeners[i](data); } catch (errAux) { console.error('DataManager aux listener:', errAux); }
    }
  }

  async _processChunk({ importId, items, targetTable, writeMode, yieldMs }) {
    if (this.abortedImports.has(importId)) {
      this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId });
      return;
    }
    const table = db[targetTable || this.targetTableDefault];
    if (writeMode === 'add') await table.bulkAdd(items);
    else await table.bulkPut(items);
    // import-rows est émis après l'écriture ; la respiration ne peut jamais bloquer.
    const requested = typeof yieldMs === 'number' && yieldMs >= 0 ? Math.min(64, yieldMs) : 32;
    await new Promise(resolve => {
      if (typeof document !== 'undefined' && document.hidden) setTimeout(resolve, requested);
      else if (requested === 0) setTimeout(resolve, 0);
      else {
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        var cap = setTimeout(finish, requested);
        requestAnimationFrame(function () { clearTimeout(cap); setTimeout(finish, 0); });
      }
    });
    this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId });
  }

  async _processComplete({ playlistId, importId, kind }) {
    if (this.abortedImports.has(importId)) return; // jamais de swap sur import avorté
    const isEpg = kind === 'epg';
    // kind 'playlist' (M3U ou Xtream) purge channels ET vod ; kind 'epg' ne purge que epg (DB-5)
    const targetTables = isEpg ? [db.epg] : [db.channels, db.vod];
    const activeField = isEpg ? 'activeEpgImportId' : 'activeImportId';

    // Swap atomique + purge strictement bornée à la playlist ET au type d'import.
    // Hors question ici : toute clause du type notEqual(importId) non bornée,
    // qui effacerait les imports actifs des AUTRES playlists.
    await db.transaction('rw', [db.playlists, db.imports, db.channels, db.epg, db.vod], async () => {
      await db.playlists.update(playlistId, Object.assign({ updatedAt: Date.now() }, { [activeField]: importId }));

      const oldImports = await db.imports
        .where('playlistId').equals(playlistId)
        .and(i => i.id !== importId && i.kind === (isEpg ? 'epg' : 'playlist'))
        .primaryKeys();

      if (oldImports.length > 0) {
        for (let t = 0; t < targetTables.length; t++) {
          await targetTables[t].where('importId').anyOf(oldImports).delete();
        }
        await db.imports.bulkDelete(oldImports);
      }

      await db.imports.update(importId, { status: 'completed' });
    });

    window.dispatchEvent(new CustomEvent('import-complete', { detail: { playlistId, importId, kind } }));
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.worker.onmessage = null;
    this.auxListeners = [];
  }
}
```

### 5.4 Fallback Non-Streaming (politique actée)

Si `canStreamFetch === false` :
- `Content-Length` présent et > 30 Mo → **refus d'importer** (event `import-error`, cause `FILE_TOO_LARGE_NO_STREAMING`).
- `Content-Length` **absent** → **refus également** (impossible de borner l'empreinte mémoire en téléchargement atomique ; hypothèse WARNING documentée : les fichiers mal annoncés sont rejetés plutôt que risquer un OOM sur TV à 1 Go de RAM).
- Le parser fallback découpe le texte par tranches de 256 Ko et rend la main via `setTimeout(0)` entre tranches, pour intercepter `ABORT_IMPORT` / `CANCEL` entre deux tranches.

### 5.5 Reprise sur Crash au Boot

Dans `bootstrap.js`, après ouverture Dexie :
1. `imports.where('status').equals('running')` → marquer `failed` (l'app a été tuée en cours d'import).
2. Orphelins : tout `importId` présent dans `channels`/`epg`/`vod` qui n'est ni un `activeImportId`/`activeEpgImportId` référencé, ni un import `running` récent (< 5 min), est purgé (`anyOf`). C'est le mécanisme de « suppression différée » rendu sûr : un kill entre le swap et la purge se rattrape au prochain boot sans corruption.

### 5.6 Rétention EPG

À chaque démarrage : `db.epg.where('stopTime').below(Date.now() - 86400000).delete()`. Le contrat de type est **`startTime`/`stopTime` : entiers epoch UTC en millisecondes** (produits par `parseXMLTVDateToUTC`, §6.3).

### 5.7 Backpressure Réseau (watermark) — principe

Le reader `fetch`/`ReadableStream` côté main thread ne se laisse pas distancer par le worker : il entretient au maximum **4 chunks texte en vol** (`inflightText <= 4`). Chaque `PARSE_CHUNK` incrémente le compteur, chaque `CHUNK_PARSED` en libère un. Sans ce bouclage, un fichier XMLTV de 50 Mo+ sur une connexion rapide gonfle la mémoire du worker pendant que Dexie écrit à son rythme. **Implémentation obligatoire : §5.8.**

### 5.8 ImportController — lecteur réseau, watermark et terminaison (implémentation de référence)

Composant pivot entre le réseau et le worker : il orchestre `fetch` → `ReadableStream` → `TextDecoder({stream:true})` → `PARSE_CHUNK`, applique le watermark, et garantit la terminaison de la promesse d'import **dans tous les cas** (complétion, erreur réseau, erreur DB remontée via `import-error`, abort). Deux pièges sont fermés par construction : les listeners de complétion sont attachés **avant** le premier envoi réseau (sinon un `import-error` émis pendant la pompe serait raté et l'appelant attendrait indéfiniment), et tout waiter de watermark suspendu est **libéré à la désactivation** (sinon la pompe resterait figée après abort).

```javascript
// src/data/ImportController.js
import { Capabilities } from '../utils/CapabilityDetector.js';

const MAX_INFLIGHT_TEXT = 4;                 // watermark réseau (§5.7)
const FALLBACK_MAX_BYTES = 30 * 1024 * 1024; // 30 Mo (politique §5.4)
const FALLBACK_SLICE = 256 * 1024;           // tranches du fallback non-streamé

export class ImportController {
  constructor(worker, dataManager) {
    this._destroyed = false;
    this.worker = worker;
    this.dataManager = dataManager;
    this.currentImportId = null;
    this.inflightText = 0;
    this.drainedWaiters = [];
    this.abortController = null;

    // Le DataManager détient worker.onmessage ; il route les signaux annexes ici.
    this.boundOnAuxMessage = this._onAuxMessage.bind(this);
    this.dataManager.addAuxListener(this.boundOnAuxMessage);
  }

  /**
   * job : { importId, playlistId, kind ('playlist'|'epg'), url }
   * Résout avec detail 'import-complete' ; rejette sur erreur réseau/DB/abort.
   * PROT-6 : un second appel pendant un import est rejeté immédiatement.
   */
  startImport(job) {
    if (this._destroyed) return Promise.reject(new Error('ImportController détruit'));
    if (this.currentImportId !== null) {
      window.dispatchEvent(new CustomEvent('import-busy', { detail: { inFlight: this.currentImportId } }));
      return Promise.reject(new Error('BUSY: import déjà en cours (PROT-6)'));
    }

    const importId = job.importId;
    this.currentImportId = importId;
    this.inflightText = 0;
    this.drainedWaiters = [];
    this.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const self = this;
    // Listeners attachés AVANT toute émission : un import-error (pompe, DB ou erreur
    // worker typée) émis en cours de route doit pouvoir rejeter cette promesse.
    const completionPromise = this._waitForCompletion(importId);

    if (job.source === 'xtream') {
      // Mode Xtream (§6.5) : le worker effectue lui-même les appels API paginés par
      // catégorie — pas de pompe réseau côté main thread, pas de watermark texte :
      // la mémoire est bornée par la plus grosse catégorie, jamais par le catalogue.
      this.worker.postMessage({
        type: 'INIT_IMPORT',
        importId: importId,
        playlistId: job.playlistId,
        kind: job.kind,
        base: job.base,
        username: job.username,
        password: job.password
      });
      return completionPromise.then(function (detail) {
        self._teardown();
        return detail;
      }, function (err) {
        self._teardown();
        throw err;
      });
    }

    this.worker.postMessage({
      type: 'INIT_IMPORT',
      importId: importId,
      playlistId: job.playlistId,
      kind: job.kind
    });

    this._pumpNetwork(job).then(function () {
      if (self.currentImportId === importId) {
        self.worker.postMessage({ type: 'END_OF_STREAM', importId: importId });
      }
      // Si avorté entre-temps : completionPromise a déjà rejeté via 'import-aborted'.
    }).catch(function (err) {
      if (self.currentImportId === importId) {
        // Échec pompe → terminaison symétrique via le canal d'erreur unique (§1.2-1)
        self.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId });
        window.dispatchEvent(new CustomEvent('import-error', {
          detail: { importId: importId, message: String((err && err.message) || err) }
        }));
      }
      // Si abort() public : 'import-aborted' déjà émis par abort().
    });

    return completionPromise.then(function (detail) {
      self._teardown();
      return detail;
    }, function (err) {
      self._teardown();
      throw err;
    });
  }

  abort() {
    const importId = this.currentImportId;
    if (importId === null || this._destroyed) return;
    if (this.abortController) {
      try { this.abortController.abort(); } catch (eAbort) { /* noop */ }
    }
    try { this.worker.postMessage({ type: 'ABORT_IMPORT', importId: importId }); } catch (eAbort2) { /* noop */ }
    window.dispatchEvent(new CustomEvent('import-aborted', { detail: { importId: importId } }));
    // _teardown() exécuté par la terminaison de startImport (voie unique)
  }

  async _pumpNetwork(job) {
    const importId = job.importId;
    const fetchOptions = this.abortController ? { signal: this.abortController.signal } : {};
    const response = await fetch(job.url, fetchOptions);
    if (!response.ok) throw new Error('HTTP_' + response.status);

    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10) || 0;
    const canStream = Capabilities.hasFetch && Capabilities.hasReadableStream && Capabilities.hasTextDecoder &&
                      response.body && typeof response.body.getReader === 'function';

    if (!canStream) {
      // Politique actée §5.4 : plafond dur 30 Mo ; taille inconnue → refus (borne mémoire impossible)
      if (contentLength === 0) throw new Error('CONTENT_LENGTH_ABSENT_NO_STREAMING');
      if (contentLength > FALLBACK_MAX_BYTES) throw new Error('FILE_TOO_LARGE_NO_STREAMING');
      const fullText = await response.text();
      for (let start = 0; start < fullText.length; start += FALLBACK_SLICE) {
        if (this.currentImportId !== importId) return; // avorté : sortie silencieuse
        this._sendParseChunk(importId, fullText.slice(start, start + FALLBACK_SLICE));
        // await-in-loop volontaire : rendu de main pour intercepter ABORT entre tranches
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let result = await reader.read();
    while (!result.done) {
      if (this.currentImportId !== importId) {
        try { reader.cancel(); } catch (e1) { /* noop */ }
        return;
      }
      // { stream: true } : les séquences UTF-8 multi-octets coupées entre chunks réseau
      // sont conservées pour le decode suivant — défense complémentaire au carryOver XML
      const text = decoder.decode(result.value, { stream: true });
      if (text.length > 0) {
        const free = await this._awaitSlotOrAborted(importId); // watermark (§5.7)
        if (!free) {
          try { reader.cancel(); } catch (e2) { /* noop */ }
          return;
        }
        this._sendParseChunk(importId, text);
      }
      result = await reader.read();
    }

    const tail = decoder.decode(); // flush final du décodeur
    if (tail.length > 0) {
      const freeTail = await this._awaitSlotOrAborted(importId);
      if (!freeTail) return;
      this._sendParseChunk(importId, tail);
    }
  }

  _sendParseChunk(importId, text) {
    this.inflightText += 1;
    this.worker.postMessage({ type: 'PARSE_CHUNK', importId: importId, xmlChunk: text });
  }

  _awaitSlotOrAborted(importId) {
    const self = this;
    if (this.currentImportId !== importId) return Promise.resolve(false);
    if (this.inflightText < MAX_INFLIGHT_TEXT) return Promise.resolve(true);
    return new Promise(function (resolve) {
      self.drainedWaiters.push(function () {
        resolve(self.currentImportId === importId);
      });
    });
  }

  _onAuxMessage(data) {
    if (!data || data.type !== 'CHUNK_PARSED') return;
    if (data.importId !== this.currentImportId) return;
    this.inflightText = Math.max(0, this.inflightText - 1);
    this._releaseWaiters();
  }

  _releaseWaiters() {
    // Un ack = un slot : on libère UN seul waiter (sinon rafale > watermark,
    // car les waiters résolus n'incrémentent inflightText qu'après leur microtask)
    if (this.drainedWaiters.length > 0 && this.inflightText < MAX_INFLIGHT_TEXT) {
      this.drainedWaiters.shift()();
    }
  }

  _waitForCompletion(importId) {
    return new Promise(function (resolve, reject) {
      function matches(e) { return e.detail && e.detail.importId === importId; }
      function cleanup() {
        window.removeEventListener('import-complete', onComplete);
        window.removeEventListener('import-error', onError);
        window.removeEventListener('import-aborted', onAborted);
      }
      function onComplete(e) { if (matches(e)) { cleanup(); resolve(e.detail); } }
      function onError(e) { if (matches(e)) { cleanup(); reject(new Error(e.detail.message || 'import-error')); } }
      function onAborted(e) { if (matches(e)) { cleanup(); reject(new Error('IMPORT_ABORTED')); } }
      window.addEventListener('import-complete', onComplete);
      window.addEventListener('import-error', onError);
      window.addEventListener('import-aborted', onAborted);
    });
  }

  _teardown() {
    this.currentImportId = null;
    this.inflightText = 0;
    // Libère tout waiter suspendu : les résolutions sont des microtasks exécutées
    // après ce teardown (currentImportId déjà null) → la pompe sort proprement.
    while (this.drainedWaiters.length > 0) {
      const release = this.drainedWaiters.shift();
      try { release(); } catch (e3) { /* noop */ }
    }
    this.abortController = null;
  }

  destroy() {
    if (this._destroyed) return;
    this.abort();
    this._destroyed = true;
    this.dataManager.removeAuxListener(this.boundOnAuxMessage);
    this.drainedWaiters = [];
  }
}
```

**Filet anti-crash worker — wiring obligatoire, Sprint 1 (corrigé) :** si le worker *crashe* (exception non interceptée dans son propre code), aucun message ne revient — `COMPLETE` comme `CHUNK_COMMITTED` n'arriveront jamais. Le `worker.onerror` natif émet un `ErrorEvent` **sans propriété `importId`** : un branchement direct vers la voie terminale ne trouverait aucun import à clôturer (early-return) et la promesse d'import resterait suspendue indéfiniment. Le bootstrapper injecte donc explicitement l'import courant :

```javascript
// src/bootstrap.js — filet contre le crash worker
worker.onerror = function (ev) {
  // ev : ErrorEvent natif SANS importId → injection explicite obligatoire
  dataManager.failImport(importController.currentImportId, (ev && ev.error) || ev);
};
```

`failImport(null, …)` (aucun import en cours) dégrade proprement en événement `worker-error` de journalisation. **Après un crash, l'instance de Worker est inutilisable** : le bootstrapper maintient une `workerFactory()` et recrée la paire Worker + DataManager + ImportController au prochain `startImport` (livrable Sprint 1, `src/bootstrap.js`).

---

## 6. Worker EPG XMLTV (Carry-Over, Fuseau Horaire, Terminaison Garantie)

### 6.1 Implémentation complète

```javascript
// src/data/epg.worker.js
let carryOver = '';
let isWaitingForAck = false;
let pendingItems = [];
let currentImportId = null;
let currentPlaylistId = null;
let isStreamEnded = false;

self.onmessage = function (e) {
  const { type, importId, playlistId, xmlChunk } = e.data;

  if (type === 'INIT_IMPORT') {
    currentImportId = importId;
    currentPlaylistId = playlistId;
    carryOver = '';
    pendingItems = [];
    isWaitingForAck = false;
    isStreamEnded = false;
    return;
  }

  if (type === 'CHUNK_COMMITTED') {
    if (importId !== currentImportId) return; // PROT-2 : ack tardif d'import mort
    isWaitingForAck = false;
    flushPendingItems(isStreamEnded); // PROT-4 : drain des restes en fin de flux
    return;
  }

  if (type === 'PARSE_CHUNK') {
    if (importId !== currentImportId) return;
    parseChunk(xmlChunk);
    self.postMessage({ type: 'CHUNK_PARSED', importId: currentImportId }); // watermark §5.7
    return;
  }

  if (type === 'END_OF_STREAM') {
    if (importId !== currentImportId) return;
    isStreamEnded = true;
    parseChunk('');
    flushPendingItems(true);
    checkCompletion();
    return;
  }

  if (type === 'ABORT_IMPORT') {
    if (importId !== null && importId !== currentImportId) return;
    currentImportId = null;
    pendingItems = [];
    carryOver = '';
    isWaitingForAck = false;
    isStreamEnded = false;
  }
};

function parseChunk(chunk) {
  // Conserve intégralement tout fragment non fermé pour le chunk suivant :
  // un paquet réseau peut couper <programme …> n'importe où.
  const text = carryOver + chunk;
  const lastCloseIndex = text.lastIndexOf('</programme>');

  if (lastCloseIndex === -1) {
    carryOver = text;
    return;
  }

  const processableText = text.substring(0, lastCloseIndex + 12); // '</programme>'.length === 12
  carryOver = text.substring(lastCloseIndex + 12);

  // Tolère un '>' littéral placé DANS une valeur d'attribut quotée (légal en XML,
  // l'échappement obligatoire ne concerne que '<' et '&') — capture adaptée en conséquence
  const programmeRegex = /<programme\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/programme>/g;
  let match;

  while ((match = programmeRegex.exec(processableText)) !== null) {
    const attrString = match[1];
    const bodyString = match[2];

    const channel = getAttribute(attrString, 'channel');
    const startTime = parseXMLTVDateToUTC(getAttribute(attrString, 'start'));
    const stopTime = parseXMLTVDateToUTC(getAttribute(attrString, 'stop'));

    // Attributs absents ou dates invalides → item ignoré (jamais de epoch 0 en base)
    if (channel && startTime !== null && stopTime !== null) {
      pendingItems.push({
        id: currentImportId + ':' + channel + ':' + startTime, // DB-1
        importId: currentImportId,
        channelId: channel,
        startTime: startTime,
        stopTime: stopTime,
        title: extractTagText(bodyString, 'title')
      });
    }

    if (pendingItems.length >= 500) {
      flushPendingItems(false);
    }
  }
}

function getAttribute(attrString, name) {
  // Ordre des attributs XML non garanti + apostrophes légales en XML
  const reg = new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i');
  const m = reg.exec(attrString);
  return m ? m[1] : null;
}

function extractTagText(body, tagName) {
  const reg = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i');
  const m = reg.exec(body);
  if (!m) return '';

  let text = m[1].trim();

  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  if (cdataMatch) text = cdataMatch[1];

  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')   // &amp; EN DERNIER (ordre des unescape)
    .trim();
}

function parseXMLTVDateToUTC(str) {
  // Format XMLTV : YYYYMMDDHHMMSS ±HHMM (offset optionnel) → epoch UTC ms
  if (!str) return null;
  // Secondes optionnelles : certains grabbers émettent des dates à 12 chiffres (sans SS)
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/.exec(String(str).trim());
  if (!m) return null;

  let utc = Date.UTC(
    parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
    parseInt(m[4], 10), parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0
  );

  if (m[7]) {
    const sign = m[7].charAt(0) === '-' ? -1 : 1;
    const offH = parseInt(m[7].substr(1, 2), 10);
    const offM = parseInt(m[7].substr(3, 2), 10);
    utc -= sign * (offH * 3600 + offM * 60) * 1000; // "18:00 +0100" → 17:00 UTC
  }

  return isNaN(utc) ? null : utc;
}

function flushPendingItems(force) {
  if (isWaitingForAck || pendingItems.length === 0) {
    checkCompletion();
    return;
  }
  if (pendingItems.length >= 500 || force) {
    isWaitingForAck = true;
    const chunkToSend = pendingItems.splice(0, CHUNK_ITEMS); // CHUNK_ITEMS = 2000 (V10)
    self.postMessage({
      type: 'CHUNK',
      importId: currentImportId,
      items: chunkToSend,
      targetTable: 'epg'
    });
  } else {
    checkCompletion();
  }
}

function checkCompletion() {
  // PROT-3 : dernier ack reçu, file vide, flux terminé → terminaison
  if (isStreamEnded && !isWaitingForAck && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'epg' });
  }
}
```

### 6.2 Preuve de terminaison (scénario 644 programmes)

Fin de flux avec `pendingItems = 2 644` : le worker M3U/EPG émet un lot de 2 000,
attend son ack, puis émet le résiduel de 644 (le worker Xtream applique le même
raisonnement avec la taille du profil). Dernier ack → file vide → `COMPLETE`.
**Quel que soit le modulo du lot**, la séquence converge — `isStreamEnded` est
propagé dans le handler d'ack, c'est la correction décisive.

### 6.3 Cas des dates

`20260906180000 +0100` → `17:00 UTC` ✅ ; `20260906180000 -0500` → `23:00 UTC` ✅ ; `202609061800` (12 chiffres, sans secondes) → secondes = 00, toléré ✅ ; sans offset → interprété UTC (WARNING documenté : certains grabbers omettent l'offset) ; chaîne malformée → item ignoré, jamais de `1970-01-01` en base.

### 6.4 Hypothèses WARNING documentées (§1.1 NIVEAU 2)

- Titres multilingues : premier `<title>` retenu, sans filtrage par `lang`.
- Encodage : UTF-8 obligatoire ; le décodage se fait via `TextDecoder` avec `{ stream: true }` côté main thread (séquences multi-octets coupées entre chunks réseau).
- Balise ouvrante `<programme …>` : la regex tolère un `>` littéral à l'intérieur de valeurs d'attribut **quotées** (légal en XML) ; un attribut **non quoté** (XML invalide) ferait ignorer l'item — détecté par les compteurs des fixtures §9.
- Dates : secondes optionnelles (12 ou 14 chiffres acceptés, secondes = 00) ; toute autre variante (séparateurs, 2 chiffres d'année) → item ignoré, jamais parsé partiellement.
- Le worker M3U (`m3u.worker.js`) implémente **le même protocole** (§5.2) avec tokenisation `#EXTINF`/`#EXTGRP` et génère `id = importId + ':' + seq` + `searchName` normalisé (DB-3).
- **Catégories M3U (V11)** : la liste des catégories est l'ensemble distinct des `group-title`/`#EXTGRP` **dans l'ordre de première apparition dans le fichier** (le M3U n'a pas d'endpoint de catégories ; la playlist EST le serveur). Un item sans groupe porte `groupName = 'Autres'`, qui entre dans la liste à sa première occurrence. Émission par `CATEGORIES { importId, playlistId, kind:'live', categories:[{name}…] }` **avant** `COMPLETE` (message annexe additif, jamais de CHUNK).

### 6.5 Import Xtream Codes (URL + username + password) — amendement V9

**État avant amendement :** les seules sources d'import étaient une URL M3U (§5) et une URL XMLTV (§6). Un serveur Xtream *pouvait* déjà être ingéré en « M3U brut » via `get.php?username=…&password=…&type=m3u_plus`, mais sans aucune structure : catégories absentes, VOD indistinguable du Live, aucune information de compte (dont `max_connections`, indispensable au Dual Player §7.5). Cette section ajoute la connexion native à l'API Xtream Codes (`player_api.php`) avec **trois seuls paramètres d'entrée : `base URL`, `username`, `password`**.

**Architecture :**
- `src/platform/XtreamClient.js` (main thread) : constructeur/validateur d'URLs d'endpoints. Stateless, sans effet de bord, jamais de `fetch` ici.
- `src/data/xtream.worker.js` : worker d'import dédié qui **effectue lui-même ses `fetch`** (disponible dans les workers sous Chromium 68). **Mode par défaut (V10/V17) : « catalogue global »** — un appel `get_live_streams`, un appel `get_vod_streams` et un appel `get_series` **sans** `category_id` (le standard Xtream renvoie alors le catalogue entier, chaque entrée portant son `category_id` ; le nom de groupe est résolu localement via une Map construite sur `get_live_categories`/`get_vod_categories`), suivi d'un drain local par CHUNKS de `CHUNK_ITEMS` (protocole §5.2 inchangé). **Repli obligatoire** : si l'appel global échoue (HTTP ≠ 2xx, JSON invalide, ou `Content-Length` > 40 Mo), le worker retombe sur la boucle **séquentielle paginée par catégorie** de V9 — chaque réponse étant alors bornée par la taille d'une catégorie. La borne mémoire du mode global est explicite : « bornée par le catalogue le plus gros » (≈ 10–25 Mo de JSON pour 60 k entrées), valeur validée en révision — la mesure (annexe perf V10) montre que le mode par catégorie est dominé à 90–99 % par les RTT (900 catégories ≈ 2–5 min au lieu de secondes). Le carryOver textuel de §6.1 ne s'applique pas aux documents JSON structurés dans les deux modes.
- Orchestration : `ImportController.startImport({ source: 'xtream', base, username, password, importId, playlistId, kind: 'playlist', profile })` (§5.8) — même promesse de complétion, même PROT-6, mêmes événements terminaux ; `profile` est absent ou standard hors benchmark.
- Protocole worker identique à §5.2 (`INIT_IMPORT` / `CHUNK` de 500–10 000 items borné, 2 000 par défaut / `CHUNK_COMMITTED` / `COMPLETE` / `ABORT_IMPORT`) plus cinq messages propres : `ACCOUNT_INFO` (routé via `_routeAux` → listeners), `IMPORT_META` (V10 : `{ importId, playlistId, totalItems }` dès que le nombre d'entrées est connu — mode global uniquement ; **V11 : `totalItems` inclut les séries**), `IMPORT_PHASE` (V16 : `{ importId, playlistId, phase, label }`, indicateur additif de l'activité avant `IMPORT_META`, routé en `import-phase` vers le badge), `CATEGORIES` (V11 : `{ importId, playlistId, kind:'live'|'vod'|'series', categories:[{name}…] }` émis dès réception des `get_*_categories`, **ordre du serveur intact**, y compris en mode repli ; le `DataManager` en est le consommateur unique et écrit `db.categories` de façon idempotente par `(importId, kind)`) et `ERROR` (voie terminale §5.3).

V17 applique dans le worker les profils de §6.8 : `chunkItems`, `writeMode`,
`yieldMs` et `parallelCatalogs`. La récupération des trois catalogues est
parallèle sauf pour le profil 5 ; l'écriture reste séquentielle live → VOD →
séries pour conserver un ordre déterministe et une seule cible par `CHUNK`.

**Endpoints (API Xtream Codes standard) :**

| Rôle | Endpoint |
|---|---|
| Compte (auth + capacités) | `GET {base}/player_api.php?username={u}&password={p}` |
| Catégories Live | `…&action=get_live_categories` |
| Chaînes (mode global, défaut V10) | `…&action=get_live_streams` (sans `category_id`) |
| Chaînes d'une catégorie (repli V10 / mode V9) | `…&action=get_live_streams&category_id={id}` |
| Catégories VOD | `…&action=get_vod_categories` |
| Films (mode global, défaut V10) | `…&action=get_vod_streams` (sans `category_id`) |
| Films d'une catégorie (repli V10 / mode V9) | `…&action=get_vod_streams&category_id={id}` |
| Catégories Séries (V11) | `…&action=get_series_categories` |
| Séries (mode global, défaut V10) | `…&action=get_series` (sans `category_id`) |
| Séries d'une catégorie (repli) | `…&action=get_series&category_id={id}` |
| **Détail d'une série (V11, à l'ouverture seulement)** | `…&action=get_series_info&series_id={id}` |
| Lecture Live | `{base}/live/{u}/{p}/{stream_id}.m3u8` |
| Lecture VOD | `{base}/movie/{u}/{p}/{stream_id}.{container_extension}` (défaut `mp4`) |
| Lecture d'un épisode (V11) | `{base}/series/{u}/{p}/{episode_id}.{container_extension}` (défaut `mp4`) |
| **EPG du compte** | `{base}/xmltv.php?username={u}&password={p}` → **pipeline §6 existant, inchangé** (import `kind:'epg'` classique sur cette URL ; jointure via `epg_channel_id` → `channels.channelId`) |

```javascript
// src/platform/XtreamClient.js — stateless ; aucun fetch ici (le worker les fait)
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
```

```javascript
// src/data/xtream.worker.js
// La machinerie d'accusés (isWaitingForAck / flushPendingItems / checkCompletion,
// PROT-1…4) est STRICTEMENT identique à §6.1 — duplication assumée : les workers sont
// bundlés séparément en IIFE et ne partagent pas de module.
let isWaitingForAck = false;
let pendingItems = [];
let pendingTarget = 'channels';
let currentImportId = null;
let currentPlaylistId = null;
let isStreamEnded = false;
let aborted = false;
let cfg = null; // { base, username, password }

self.onmessage = function (e) {
  const d = e.data;
  if (d.type === 'INIT_IMPORT') {
    currentImportId = d.importId;
    currentPlaylistId = d.playlistId;
    pendingItems = [];
    isWaitingForAck = false;
    isStreamEnded = false;
    aborted = false;
    cfg = { base: d.base, username: d.username, password: d.password };
    runImport();
    return;
  }
  if (d.type === 'CHUNK_COMMITTED') {
    if (d.importId !== currentImportId) return;          // PROT-2
    isWaitingForAck = false;
    flushPendingItems(isStreamEnded);                     // PROT-4 (drain des résidus)
    return;
  }
  if (d.type === 'ABORT_IMPORT') {
    aborted = true;
    currentImportId = null;
    pendingItems = [];
    isWaitingForAck = false;
  }
};

function apiUrl(action, categoryId) {
  let u = cfg.base + '/player_api.php?username=' + encodeURIComponent(cfg.username) +
          '&password=' + encodeURIComponent(cfg.password);
  if (action) u += '&action=' + action;
  if (categoryId != null) u += '&category_id=' + encodeURIComponent(categoryId);
  return u;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('XTREAM_HTTP_' + res.status);
  return res.json();
}

async function runImport() {
  try {
    // 1. Compte : authentification = voie terminale (statut ≠ Active → échec immédiat)
    const account = await fetchJson(apiUrl(null));
    const info = account && account.user_info;
    if (!info || String(info.status) !== 'Active') {
      throw new Error('XTREAM_AUTH_FAILED');
    }
    self.postMessage({  // alimente DualPlayerPolicy.provider.maxConcurrentStreams (§7.5)
      type: 'ACCOUNT_INFO',
      importId: currentImportId,
      maxConnections: parseInt(info.max_connections, 10) || 0,
      expDate: info.exp_date || null
    });

    // 2. Live → channels ; 3. VOD → vod (DB-5) ; 4. Séries → series (DB-6, V11)
    // — chaque ligne porte sortIdx = position d’arrivée (DB-7, V13 : l’ordre
    //   serveur est reconstitué à la LECTURE, jamais dans les workers)
    // — boucles séquentielles bornées (mode repli ; en mode global, drain flat
    //   par tableau, séries incluses dans IMPORT_META)
    if (!aborted) await importCollection('get_live_categories', 'get_live_streams', 'channels', mapLiveItem);
    if (!aborted) await importCollection('get_vod_categories', 'get_vod_streams', 'vod', mapVodItem);
    if (!aborted) await importCollection('get_series_categories', 'get_series', 'series', mapSeriesItem);

    isStreamEnded = true;
    flushPendingItems(true);  // drain forcé du résiduel (PROT-4)
    checkCompletion();        // COMPLETE quand file vide + acks soldés (PROT-3)
  } catch (err) {
    if (currentImportId !== null) {
      self.postMessage({ type: 'ERROR', importId: currentImportId,
                         message: String((err && err.message) || err) });
    }
  }
}

async function importCollection(catAction, listAction, targetTable, mapFn) {
  const cats = await fetchJson(apiUrl(catAction));
  if (!Array.isArray(cats)) return;

  for (let c = 0; c < cats.length; c++) {
    if (aborted) return;
    const catId = cats[c] && cats[c].category_id;
    const groupName = String((cats[c] && cats[c].category_name) || 'Autres');

    let items = [];
    try {
      items = await fetchJson(apiUrl(listAction, catId));
    } catch (eCat) {
      // WARNING (§1.1-N2) : une catégorie défaillante ne sacrifie pas l'import
      continue;
    }
    if (!Array.isArray(items)) continue;

    for (let i = 0; i < items.length; i++) {
      // Ne jamais mélanger deux tables dans un même lot en attente :
      if (pendingItems.length > 0 && pendingTarget !== targetTable) {
        await drainAllForTableSwitch();
      }
      pendingTarget = targetTable;
      if (aborted) return;
      pendingItems.push(mapFn(items[i], groupName, currentImportId));
      if (pendingItems.length >= 500) {
        flushPendingItems(false);
        await waitForAck(); // suspension stricte pendant le commit Dexie (PROT-1)
      }
    }
  }
}

// Table-hopping : un CHUNK ne porte qu'UNE table cible (cohhérence DataManager.bulkPut)
function drainAllForTableSwitch() {
  forceDrainSyncHack();
  return Promise.resolve();
}

function forceDrainSyncHack() {
  // Draine par lots de 500 synchroniquement en sollicitant les acks existants :
  // en pratique cette bascule est rare (fin Live → début VOD), on force le flush
  // et on contingent la poursuite naturellement au prochain CHUNK_COMMITTED.
  flushPendingItems(true);
}

function waitForAck() {
  return new Promise(function (resolve) {
    const iv = setInterval(function () {
      if (aborted || !isWaitingForAck) { clearInterval(iv); resolve(); }
    }, 16);
  });
}

function mapLiveItem(s, groupName, importId) {
  return {
    id: importId + ':' + s.stream_id,
    importId: importId,
    name: String(s.name || ''),
    channelId: s.epg_channel_id ? String(s.epg_channel_id) : null, // jointure EPG §6
    groupName: groupName,
    logo: s.stream_icon || '',
    streamUrl: cfg.base + '/live/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + s.stream_id + '.m3u8',
    searchName: normalizeSearchName(s.name)
  };
}

function mapVodItem(s, groupName, importId) {
  const name = String(s.name || '');
  return {
    id: importId + ':' + s.stream_id,
    importId: importId,
    name: name,
    groupName: groupName,
    logo: s.stream_icon || '',
    streamUrl: cfg.base + '/movie/' + encodeURIComponent(cfg.username) + '/' +
               encodeURIComponent(cfg.password) + '/' + s.stream_id + '.' +
               (s.container_extension || 'mp4'),
    searchName: normalizeSearchName(s.name)
  };
}

function normalizeSearchName(name) {
  return String(name || '').toLowerCase().normalize('NFD')
           .replace(/[\u0300-\u036f]/g, ''); // DB-3 (identique §5.1)
}

// — Machinerie d'accusés : copie conforme §6.1 (PROT-1…4) —
function flushPendingItems(force) {
  if (isWaitingForAck || pendingItems.length === 0) { checkCompletion(); return; }
  if (pendingItems.length >= 500 || force) {
    isWaitingForAck = true;
    const items = pendingItems.splice(0, 500);
    self.postMessage({ type: 'CHUNK', importId: currentImportId,
                       items: items, targetTable: pendingTarget });
  } else {
    checkCompletion();
  }
}

function checkCompletion() {
  if (isStreamEnded && !isWaitingForAck && pendingItems.length === 0 && currentImportId !== null) {
    const importId = currentImportId;
    const playlistId = currentPlaylistId;
    currentImportId = null; // protocole terminé : jamais de double COMPLETE
    self.postMessage({ type: 'COMPLETE', playlistId: playlistId, importId: importId, kind: 'playlist' });
  }
}
```

**Règles propres à Xtream (XP-1…XP-4) :**
- XP-1 : l'authentification est tentée **en premier** ; échec → `ERROR / XTREAM_AUTH_FAILED` avant toute écriture (voie terminale §5.3). Jamais de retry sur 401/403 (cf. matrice §7.1, même philosophie).
- XP-2 : un seul import Xtream en vol (PROT-6 via ImportController) ; une playlist = **une seule source** (M3U *ou* Xtream), choisie à la création — cela évite toute purge croisée ambiguë (la purge §5.3 bornée au `playlistId` resterait correcte, mais l'UX devient confuse).
- XP-3 (sécurité, WARNING documenté) : les credentials transitent en clair dans les URLs de lecture (intrinsèque au protocole Xtream) — **interdiction de les journaliser** ; stockage en base acté en clair (WARNING, révocable par ré-authentification).
- XP-4 (robustesse, WARNING documenté) : une catégorie défaillante (HTTP !ok, JSON invalide) est **ignorée sans faire échouer l'import** — les panels Xtream sont notoirement instables ; l'échec n'est terminal que pour l'appel compte (auth).

### 6.6 Séries Xtream — parcours, détail paresseux, lecture (ajout V11)

**Périmètre :** les séries sont un concept **Xtream uniquement** (l'API M3U n'a ni
`get_series` ni `get_series_info`) ; la table `series` reste vide pour une source
M3U, et l'onglet Séries affiche « aucune donnée » sans erreur.

- **Import** : troisième collection du même worker et du même protocole (§5.2).
  Mode par défaut : `get_series` global (même couple de gardes qu'en §6.5 :
  HTTP ≠ 2xx, JSON invalide ou `Content-Length` > 40 Mo → repli par catégories
  `get_series_categories` → `get_series&category_id=…`). Mapping `mapSeriesItem` :
  `id = importId + ':' + series_id`, `seriesId`, `name`, `groupName` (Map catégorie
  serveur ; inconnue → `'Autres'`), `logo` (← `cover`), `plot`, `rating`,
  `releaseDate`, `searchName` (DB-3). **Aucun épisode n'est importé** (un panneau
  moyen ferait exploser le store : ~300 Mo de JSON).
- **Détail (`src/services/SeriesBrowser.js`, main thread)** : un appel
  `get_series_info&series_id=…` **à la première ouverture** de la série seulement ;
  petit JSON (jamais un flux), donc explicitement hors protocole d'import — pas de
  worker, pas d'ack, pas de watermark. Réponse normalisée en
  `{ title, cover, plot, rating, seasons:[{ number, name, episodes:[{ id, episodeId,
  title, ext, plot }] }] }` (trois formes de panneaux sont acceptées :
  `seasons[idx].episodes[num]` legacy, réponse Xtream standard
  `episodes:{"1":[episode…],"2":[episode…]}` où `episode_num` est le numéro
  affiché et `id` l'identifiant de lecture, ou `entries` aplati → une saison
  synthétique ; seuls les indices legacy 0-based sont décalés en 1-based ; les
  clés de saison Xtream standard restent leurs numéros ; épisodes triés par
  `episode_id` puis `episode_num`).
  Mise en cache dans `db.series_info` (id = `series.id`, TTL 24 h) ; un échec
  HTTP/JSON/réseau lève côté UI (`SERIES_INFO_HTTP_{status}` / `SERIES_INFO_INVALID`
  / `SERIES_INFO_UNAVAILABLE`) avec bouton « Réessayer », **sans jamais mettre en
  cache ni affecter l'import** (l'esprit XP-4 appliqué au détail).
- **Lecture** : `XtreamClient.seriesStreamUrl(base,u,p,episode_id,ext)` →
  `{base}/series/{u}/{p}/{episode_id}.{container_extension}` (défaut `mp4`) ;
  lecture via le même `MediaAdapter`/overlay que la VOD (pas de nouveau pipeline).
- **Navigation en deux temps (V12)** : l'overlay détail présente d'abord la
  **liste des saisons** (bouton par saison, « Saison n — k épisode(s) »), puis
  les **épisodes de la saison choisie** avec un bouton « ← Toutes les saisons ».
  Panneau à **saison unique → le niveau saisons est sauté** (accès direct aux
  épisodes, sans bouton retour inutile). Le retour (Échap, Back webOS 461, STOP,
  ou flèche gauche au niveau épisodes) dépile la pile LIFO du moteur : épisodes
  → saisons → fermeture. Depuis le lecteur, PROG±/↑↓ zappent **l'épisode
  précédent/suivant de la saison en cours de lecture**.
- **Parcours par catégories (§6.4/§6.5)** : chaque liste (Chaînes, Films, Séries)
  est précédée d'un `<select>` de catégories alimenté par `db.categories`
  (`[importId+kind]`, ordre `sort` = ordre serveur exact), préfixé de « Toutes les
  catégories » ; les groupes présents dans les items mais absents du serveur sont
  ajoutés en fin de liste (tolérance panneaux incohérents / `'Autres'` M3U). Le
  filtre s'applique **avant** la recherche par préfixe et le plafond §8 (`SEARCH_LIMIT`) ;
  le filtre courant est réinitialisé proprement quand les lignes changent (réimport).

---

### 6.7 Playlist Xtream par défaut et performance d'amorçage (ajout V16)

- Au premier boot, si la playlist Xtream de démarrage n'existe pas déjà
  (identité = `base` + `username`), `PlaylistManager.ensureDefaultPlaylist`
  l'ajoute une seule fois et l'UI la sélectionne. L'utilisateur peut donc
  cliquer directement sur **Importer** ; aucun import automatique n'est lancé.
  Les identifiants compilés dans `src/config.js` sont une commodité de test,
  **pas un secret** : ils sont récupérables depuis l'IPK.
- Le worker Xtream émet `IMPORT_PHASE` dès l'authentification, puis aux étapes
  catégories, téléchargement des catalogues et écriture de chaque collection.
  Le badge affiche cette phase avant que le nombre total de lignes soit connu ;
  il reste non interactif et hors focus D-pad.
- Les trois appels indépendants `get_live_streams`, `get_vod_streams` et
  `get_series` sont lancés en parallèle après l'authentification/catégories.
  L'ordre d'écriture reste strictement live → vod → séries, `IMPORT_META` reste
  émis une seule fois avec le total complet quand les réponses sont disponibles,
  et le repli par catégories reste inchangé si une réponse globale échoue.
  Cette parallélisation réduit le temps mort avant le premier pourcentage sans
  augmenter le nombre d'items conservés simultanément par rapport au mode global
  précédent ; les phases permettent de distinguer réseau/JSON de l'écriture IDB.

### 6.8 Profils de benchmark Xtream V17 — boutons Test import 1 à 5

Sur chaque ligne de playlist `source: 'xtream'`, l'interface affiche, en plus du
bouton **Importer** normal, exactement cinq boutons visibles : **Test import 1**,
**Test import 2**, **Test import 3**, **Test import 4** et **Test import 5**. Ils
appellent tous `PlaylistManager.importPlaylist(playlistId, { profile })` et
empruntent donc le même `importId` neuf, le même worker, le même protocole
`CHUNK_COMMITTED`, le même swap atomique et les mêmes purges bornées. Aucun bouton
ne déclenche d'import automatiquement au boot ; les playlists M3U n'affichent
aucun bouton de benchmark.

Le profil est appliqué uniquement dans `xtream.worker.js`. Les valeurs sont
bornées (`chunkItems` entre 500 et 10 000, `yieldMs` entre 0 et 64 ms) ; toute
valeur inconnue retombe sur le réglage standard. `DataManager` choisit
`bulkPut` par défaut et n'utilise `bulkAdd` que lorsque le profil le demande.
`bulkAdd` est une variante diagnostique : les clés sont propres à l'`importId`
neuf ; si elle échoue, la voie d'erreur normale marque l'import en échec et
aucun swap ne peut exposer un import partiel. Le bouton **Importer** normal reste
le réglage de référence sûr et idempotent (`bulkPut`).

| Bouton | Profil | Lots | Écriture | Respiration | Catalogues |
|---|---|---:|---|---:|---|
| `Test import 1` | standard | 2 000 | `bulkPut` | 32 ms | parallèle |
| `Test import 2` | lots 4 000 | 4 000 | `bulkPut` | 16 ms | parallèle |
| `Test import 3` | lots 8 000 | 8 000 | `bulkPut` | 0 ms | parallèle |
| `Test import 4` | lots 4 000 | 4 000 | `bulkAdd` | 8 ms | parallèle |
| `Test import 5` | diagnostic séquentiel | 2 000 | `bulkPut` | 32 ms | séquentiel |

Le worker conserve l'ordre d'écriture **chaînes → films → séries** et attend
un accusé pour chaque lot : les protections de fin de flux, d'abort, de swap et
de purge ne sont pas désactivées. Le profil est propagé dans `import-start` et
le temps mesuré depuis le démarrage du job jusqu'à `COMPLETE` est émis dans
`import-finished` sous `elapsedMs`, avec `profileId` et `profileLabel`. Après
réception de `import-finished`, le badge affiche le profil et la durée totale en
secondes ; cette télémétrie est additive, non bloquante et ne journalise jamais
le mot de passe.

### 6.9 Quota de stockage pendant les imports de benchmark (V17.1)

Le swap atomique impose temporairement la coexistence de l'import actif et du
nouvel import de staging : cette propriété est conservée, car supprimer
l'ancien catalogue avant `COMPLETE` casserait l'intégrité et le rollback logique.
Un échec de lot ou de transaction peut toutefois laisser des lignes partielles.
`DataManager.failImport` les supprime immédiatement dans toutes les tables
(`channels`, `vod`, `series`, `series_info`, `categories`, `epg`) par
`importId`, et `PlaylistManager` retire au lancement suivant les imports
`failed` historiques et leurs lignes. L'import actif n'est jamais ciblé.

Si la capacité reste insuffisante même pour l'ancien catalogue plus un staging
complet, le comportement conforme est : pas de swap partiel, ancien catalogue
conservé, événement `import-error` avec le code `STORAGE_QUOTA`. L'opérateur
peut alors libérer le stockage de l'application / du site puis relancer ; cette
situation est distincte d'une accumulation de stagens échoués et ne doit pas
être résolue par une purge silencieuse de l'import actif.

---

## 7. Pipeline Média — Machine d'État, Fallback, Watchdog, Cycle de Vie

### 7.1 Machine d'État & Taxonomie des Erreurs

```
 IDLE ──play(url)──▶ LOADING ──'playing'──▶ PLAYING ──stall 8s──▶ (STALLED)
   ▲                  │  │                      │                    │
   │                  │  └─ error/timeout ──▶ fallback MSE          ├─ engine NATIVE → fallback MSE
   │                  │                        (passage unique)     └─ engine MSE → RECOVERING (×1 max)
   │                  └──────────────────────────────────────────▶ ERROR
 PLAYING ──'ended' (VOD)──▶ ENDED           RECOVERING ──échec──▶ ERROR
 ERROR ──play() nouveau────▶ LOADING (nouveau requestId)
```

**Règles de décision (matrice unique de l'adapter) :**

| Événement | Moteur | Action |
|---|---|---|
| `play()` rejeté / événement `error` natif en state `LOADING` / expiration de la fenêtre d'inactivité startup (10 s sans progression ni requête active) | NATIVE | `STARTUP_INCOMPATIBILITY` → **fallback HLS_MSE** ; un flux FHD réellement en téléchargement n'est pas basculé prématurément (plafond total 45 s) |
| mêmes événements en state `LOADING` | HLS_MSE | → `ERROR` (passage unique épuisé) |
| `error` ou stall du Watchdog en `PLAYING` | quelconque | `NETWORK_INTERRUPTION` → RECOVERING **intra-moteur**, max 1 **par moteur** (budget réinitialisé au changement de moteur et à chaque nouveau `play()`) |
| échec de la reconnexion (error / timeout en state `RECOVERING`) | NATIVE | retry épuisé → **fallback HLS_MSE** (passage unique préservé) |
| échec de la reconnexion (error / timeout en state `RECOVERING`) | HLS_MSE | → `ERROR` |
| Erreur hls.js `fatal` avec `response.code ∈ {401, 403}` | HLS_MSE | `AUTHORIZATION_ERROR` → **`ERROR` immédiat, aucun retry** |
| Erreur hls.js `mediaError` fatale | HLS_MSE | `hls.recoverMediaError()` — max 1, compteur partagé |
| Tout événement dont le `requestId` ≠ courant | — | **Rejeté silencieusement** (anti-race zapping) |

Note plateforme : la balise `<video>` native de webOS (pipeline GStreamer interne) lit déjà HLS nativement mais **ne remonte pas les codes HTTP** — la détection 401/403 n'est fiable qu'en HLS_MSE (via hls.js). D'où la règle : l'échec natif indéterminé passe toujours d'abord par le fallback MSE, qui qualifiera l'erreur.

### 7.2 MediaAdapter (implémentation de référence)

```javascript
// src/media/MediaAdapter.js
import Hls from 'hls.js';
import { MediaWatchdog } from './Watchdog.js';

const STARTUP_TIMEOUT_MS = 10000; // fenêtre d'inactivité, pas un cap absolu (V14)
const STARTUP_DEADLINE_MS = 45000; // plafond total jusqu'à la première image (V14)
const MAX_RECOVERIES = 1;

export class MediaAdapter {
  constructor(videoElement) {
    this._destroyed = false;
    this.videoEl = videoElement;
    this.state = 'IDLE';       // IDLE | LOADING | PLAYING | RECOVERING | ERROR | ENDED
    this.engine = null;        // null | 'NATIVE' | 'HLS_MSE'
    this.hls = null;
    this.currentUrl = null;
    this.currentRequestId = 0;
    this.recoveries = 0;
    this.startupTimer = null;
    this.recoveryTimer = null;   // reconnexion planifiée, annulable (anti timer-zombie)
    this.watchdog = new MediaWatchdog(this);

    this.boundOnVideoError = this._onVideoError.bind(this);
    this.boundOnPlaying = this._onPlaying.bind(this);
    this.boundOnEnded = this._onEnded.bind(this);
  }

  init() {
    if (this._destroyed) return;
    this.videoEl.addEventListener('error', this.boundOnVideoError);
    this.videoEl.addEventListener('playing', this.boundOnPlaying);
    this.videoEl.addEventListener('ended', this.boundOnEnded);
  }

  play(streamUrl) {
    if (this._destroyed) return -1;
    const requestId = ++this.currentRequestId;
    this._teardownPlayback();
    this.currentUrl = streamUrl;
    this.recoveries = 0;
    this.engine = 'NATIVE';
    this.state = 'LOADING';
    this._armStartupTimeout(requestId);
    this.videoEl.src = streamUrl;
    this._tryPlay(requestId);
    return requestId;
  }

  _tryPlay(requestId) {
    let p = null;
    try { p = this.videoEl.play(); } catch (e) { /* sync throw → fallback */ }
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (this.currentRequestId !== requestId || this._destroyed) return;
        if (this.state === 'LOADING') {
          this._onStartupFailure(requestId, 'play() rejected: ' + (err && err.name));
        } else if (this.state === 'RECOVERING') {
          this._tryRecover('play() rejected during recovery'); // compteur épuisé → fallback/ERROR
        }
      });
    }
  }

  _onPlaying() {
    if (this._destroyed || this.state === 'IDLE' || this.state === 'ERROR') return;
    this.state = 'PLAYING';
    this._clearStartupTimeout();
    this.watchdog.start(this.currentRequestId);
  }

  _onEnded() {
    if (this._destroyed) return;
    this.state = 'ENDED';
    this.watchdog.stop();
  }

  _onVideoError() {
    if (this._destroyed) return;
    if (this.state === 'LOADING') {
      this._onStartupFailure(this.currentRequestId, 'native <video> error event');
    } else if (this.state === 'PLAYING') {
      this._onPlaytimeFailure('native runtime error');
    } else if (this.state === 'RECOVERING') {
      this._tryRecover('error event during recovery'); // la reconnexion a échoué
    }
  }

  _onStartupFailure(requestId, reason) {
    if (this.currentRequestId !== requestId || this._destroyed) return;
    if (this.engine === 'NATIVE') {
      console.warn('STARTUP_INCOMPATIBILITY (' + reason + ') → fallback HLS_MSE');
      this._fallbackToHls(requestId);
    } else {
      this._setError('STARTUP_FAILURE: ' + reason);
    }
  }

  _onPlaytimeFailure(reason) {
    // Taxonomie d'origine : NETWORK_INTERRUPTION → reconnexion intra-moteur ×1 AVANT tout
    // changement de moteur. La bascule NATIVE → HLS_MSE n'intervient qu'à l'épuisement
    // de cette tentative (passage unique toujours respecté : jamais de retour MSE → NATIVE).
    this._tryRecover(reason);
  }

  handleStallTimeout() {
    // Appelé par le Watchdog (one-shot) après 8 s sans progression en PLAYING
    if (this._destroyed || this.state !== 'PLAYING') return;
    this._onPlaytimeFailure('WATCHDOG_STALL_8S');
  }

  _tryRecover(reason) {
    if (this.recoveries >= MAX_RECOVERIES) {
      if (this.engine === 'NATIVE') {
        // Retry intra-moteur épuisé → le second moteur reste disponible (passage unique)
        console.warn('NATIVE recovery exhausted (' + reason + ') → fallback HLS_MSE');
        this._fallbackToHls(this.currentRequestId);
      } else {
        this._setError('NETWORK_INTERRUPTION exhausting retries: ' + reason);
      }
      return;
    }
    this.recoveries += 1;
    this.state = 'RECOVERING';
    this.watchdog.stop();
    this._armStartupTimeout(this.currentRequestId); // borne aussi la phase de reconnexion
    const requestId = this.currentRequestId;
    const self = this;
    this.recoveryTimer = setTimeout(function () {
      self.recoveryTimer = null;
      if (self._destroyed || self.currentRequestId !== requestId) return;
      if (self.engine === 'HLS_MSE' && self.hls) {
        self.hls.startLoad(-1);   // relance le pipeline réseau hls.js
      } else if (self.engine === 'NATIVE') {
        self.videoEl.src = self.currentUrl;
        self._tryPlay(requestId); // reconnexion intra-moteur (coupures < seuil : le natif reprend seul)
      }
    }, 1000);
  }

  _fallbackToHls(requestId) {
    if (this._destroyed || this.engine !== 'NATIVE') return; // passage unique
    this._teardownPlayback();
    this.engine = 'HLS_MSE';
    this.state = 'LOADING';
    // Budget de reconnexion frais PAR MOTEUR (taxonomie : "max 1 par moteur").
    // Sans cette remise à zéro, un fallback atteint après épuisement du jeton
    // NATIVE laisserait HLS_MSE sans AUCUNE marge réseau : la résilience
    // dépendrait du chemin d'arrivée sur le moteur — asymétrie inacceptable.
    this.recoveries = 0;

    if (!Hls.isSupported()) {
      this._setError('MSE_NON_SUPPORTE');
      return;
    }

    this._armStartupTimeout(requestId);
    const hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
    this.hls = hlsInstance;

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      // Garde générationnelle : instance courante + requestId courant
      if (this._destroyed || this.hls !== hlsInstance || this.currentRequestId !== requestId) return;
      if (data && data.response && (data.response.code === 401 || data.response.code === 403)) {
        this._setError('AUTHORIZATION_ERROR HTTP ' + data.response.code); // jamais de retry
        return;
      }
      if (data && data.fatal) {
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.recoveries < MAX_RECOVERIES) {
          this.recoveries += 1;
          hlsInstance.recoverMediaError();
        } else {
          this._tryRecover('HLS_FATAL_' + (data && data.type));
        }
      }
    });

    hlsInstance.loadSource(this.currentUrl);
    hlsInstance.attachMedia(this.videoEl);
    this._tryPlay(requestId);
  }

  _armStartupTimeout(requestId) {
    this._clearStartupTimeout();
    this.startupTimer = setTimeout(() => {
      if (this._destroyed || this.currentRequestId !== requestId) return;
      if (this.state === 'LOADING') {
        this._onStartupFailure(requestId, 'startup timeout ' + STARTUP_TIMEOUT_MS + 'ms');
      } else if (this.state === 'RECOVERING') {
        this._tryRecover('recovery timeout'); // compteur épuisé → fallback ou ERROR
      }
    }, STARTUP_TIMEOUT_MS);
  }

  _clearStartupTimeout() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  _setError(message) {
    this.state = 'ERROR';
    const detail = { requestId: this.currentRequestId, url: this.currentUrl, message: message };
    this._teardownPlayback();
    window.dispatchEvent(new CustomEvent('media-error', { detail: detail }));
  }

  _teardownPlayback() {
    this.watchdog.stop();
    this._clearStartupTimeout();
    // Annule toute reconnexion planifiée : un changement de moteur/session pendant
    // la fenêtre d'attente (1 s) ne doit jamais laisser un timer zombie agir sur
    // le nouvel état (ex. startLoad() sur la fraîche instance hls.js).
    if (this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.videoEl) {
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }
  }

  getPosition() {
    return this.videoEl ? this.videoEl.currentTime : 0;
  }

  // Libération VPU sans destruction de l'adapter (réutilisable au retour de veille)
  releaseHardware() {
    this._teardownPlayback();
    this.state = 'IDLE';
    this.engine = null;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.releaseHardware();
    this.videoEl.removeEventListener('error', this.boundOnVideoError);
    this.videoEl.removeEventListener('playing', this.boundOnPlaying);
    this.videoEl.removeEventListener('ended', this.boundOnEnded);
  }
}
```

### 7.2.1 Amendement V14 — démarrage FHD lent (règle normative)

La trace terrain fournie le 2026-09-10 montre un scénario sain mais lent :
playlist `.m3u8` en `200`/`302` puis segment `.ts` d'environ 3 Mo en cours de
transfert. L'ancien minuteur dur de 10 000 ms pouvait produire
`STARTUP_FAILURE: startup timeout 10000ms` avant la première image. **La règle
ci-dessous remplace le cap dur de 10 s de l'extrait de référence §7.2.**

- `startupMs = 10 000 ms` est une **fenêtre d'inactivité**, non une limite
  totale : toute progression observable réarme cette fenêtre.
- Progression native : événements `loadedmetadata`, `loadeddata`, `progress`,
  `canplay`, `timeupdate`, et `HTMLMediaElement.networkState === 2`
  (`NETWORK_LOADING`) — ce dernier cas couvre les webOS qui ne notifient pas
  régulièrement `progress` pendant un gros segment FHD.
- Progression HLS_MSE : événements hls.js `MANIFEST_LOADED`, `MANIFEST_PARSED`,
  `LEVEL_LOADED`, `FRAG_LOADED`, `FRAG_BUFFERED`, `BUFFER_APPENDED` ;
  `MANIFEST_LOADING`, `LEVEL_LOADING` et surtout `FRAG_LOADING` marquent en plus
  une requête active. À l'expiration de la fenêtre, une requête active est
  réarmée au lieu de déclencher une erreur — un segment de 3 Mo peut donc
  dépasser 10 s sans faux négatif.
- `startupDeadlineMs = 45 000 ms` est fixé à l'entrée de `play()` et **n'est
  jamais réarmé** par les événements de progression ni lors du passage
  NATIVE→HLS_MSE. Un flux qui produit des marqueurs mais ne livre jamais sa
  première image finit en `STARTUP_TIMEOUT_CAP`; un flux silencieux sans
  requête active suit la décision de §7.1 (NATIVE → fallback, HLS_MSE →
  `STARTUP_FAILURE`).
- `playing` annule les deux bornes et arme le `MediaWatchdog` normal. Les
  callbacks HLS vérifient `hlsInstance === this.hls` et `requestId` courant ;
  `_teardownPlayback()` détruit les listeners/instance et remet l'indicateur
  de requête active à zéro. Ainsi un ancien zapping ne peut pas repousser le
  timeout du nouveau flux.

La fixture `media-startup-fhd` (§9) vérifie : progression `FRAG_LOADING` avant
`FRAG_LOADED`, `NETWORK_LOADING` natif, silence terminal, plafond absolu et
événements `<video>`. La recette V17.1 a **81 tests** verts dans l'environnement
de livraison.

---

### 7.3 Watchdog (one-shot, inchangé depuis V4 — validé)

```javascript
// src/media/Watchdog.js
export class MediaWatchdog {
  constructor(adapter) {
    this.adapter = adapter;
    this.timer = null;
    this.lastTime = 0;
    this.stalledSeconds = 0;
    this.fired = false;
  }

  start(requestId) {
    this.stop();
    this.fired = false;
    this.timer = setInterval(() => {
      if (this.fired || this.adapter.currentRequestId !== requestId) return;
      const video = this.adapter.videoEl;
      if (!video || video.paused) return;
      if (video.currentTime === this.lastTime && video.readyState < 3) {
        this.stalledSeconds += 1;
        if (this.stalledSeconds >= 8) {
          this.fired = true;   // tir unique : pas de rafale de handleStallTimeout
          this.stop();
          this.adapter.handleStallTimeout();
        }
      } else {
        this.lastTime = video.currentTime;
        this.stalledSeconds = 0;
      }
    }, 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stalledSeconds = 0;
  }
}
```

### 7.4 LifecycleAdapter — Libération VPU **avec** reprise de session

Conserver le décodeur matériel en arrière-plan provoque le kill brutal du processus par webOS. Mais la destruction doit être **précédée d'une sauvegarde** et **suivie d'une restauration**, sinon le test de qualification « Home pendant la lecture » échoue côté reprise.

```javascript
// src/platform/LifecycleAdapter.js
export class LifecycleAdapter {
  /**
   * @param mediaAdapter MediaAdapter
   * @param urlResolver  async (url) => freshUrl — optionnel ; ré-authentifie les URL à token
   *                     expirant (patterns IPTV courants : ?token=, signatures courtes).
   *                     Si absent, l'URL est rejouée telle quelle.
   */
  constructor(mediaAdapter, urlResolver) {
    this._destroyed = false;
    this.mediaAdapter = mediaAdapter;
    this.urlResolver = typeof urlResolver === 'function' ? urlResolver : null;
    this.savedState = null;
    this._restoring = false;
    this.boundOnVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  init() {
    if (this._destroyed) return;
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
  }

  handleVisibilityChange() {
    if (this._destroyed) return;

    if (document.hidden) {
      const wasActive = this.mediaAdapter.state === 'PLAYING' ||
                        this.mediaAdapter.state === 'LOADING' ||
                        this.mediaAdapter.state === 'RECOVERING';
      this.savedState = {
        url: this.mediaAdapter.currentUrl,
        position: this.mediaAdapter.getPosition(), // utile VOD ; ignoré en Live
        wasActive: wasActive
      };
      // Destruction totale du pipeline → le VPU est libéré avant la suspension webOS
      this.mediaAdapter.releaseHardware();
      return;
    }

    // Retour avant-plan : reprise uniquement si une session était active
    if (this.savedState && this.savedState.wasActive && this.savedState.url && !this._restoring) {
      this._restoring = true;
      const snapshot = this.savedState;
      this.savedState = null;
      this._restore(snapshot);
    }
  }

  _restore(snapshot) {
    const self = this;
    const resolveUrl = this.urlResolver
      ? this.urlResolver(snapshot.url)
      : Promise.resolve(snapshot.url);

    resolveUrl.then(function (freshUrl) {
      if (self._destroyed) return;
      const requestId = self.mediaAdapter.play(freshUrl);
      // Reprise de position VOD : un seul essai, sur 'playing' du nouveau requestId
      if (snapshot.position > 5) {
        const seekOnce = function () {
          if (self.mediaAdapter.currentRequestId !== requestId) return;
          self.videoSeekTo(snapshot.position);
          self.mediaAdapter.videoEl.removeEventListener('playing', seekOnce);
        };
        self.mediaAdapter.videoEl.addEventListener('playing', seekOnce);
      }
    }).catch(function (err) {
      window.dispatchEvent(new CustomEvent('media-error', {
        detail: { message: 'RESTORE_FAILURE: ' + ((err && err.message) || err) }
      }));
    }).then(function () {
      self._restoring = false;
    });
  }

  videoSeekTo(position) {
    try { this.mediaAdapter.videoEl.currentTime = position; } catch (e) { /* flux live non cherchable */ }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
  }
}
```

### 7.5 DualPlayerPolicy (allowlist SoC + version SDK + abonnement)

```javascript
// src/media/DualPlayerPolicy.js
export const DualPlayerPolicy = {
  // Allowlist laboratoire : préfixes modelName validés physiquement (deviceInfo.modelName)
  ALLOWED_MODELS: ['OLED65G2', 'OLED77G2', 'QNED99', 'QNED91'],

  HOVER_DELAY_MS: 800, // focus immobile minimal avant activation du second player

  /**
   * capabilities : rapport de CapabilityDetector (§3) — webosVersion issue du SDK, pas de l'UA
   * provider      : { maxConcurrentStreams } fourni par l'abonnement
   */
  isEligible(capabilities, provider) {
    if (!capabilities || !capabilities.isWebOS6OrHigher) return false;
    if (!provider || provider.maxConcurrentStreams < 2) return false;
    const model = capabilities.modelName || '';
    for (let i = 0; i < this.ALLOWED_MODELS.length; i++) {
      if (model.indexOf(this.ALLOWED_MODELS[i]) === 0) return true;
    }
    return false;
  },

  shouldActivate(focusStillMs) {
    return focusStillMs >= this.HOVER_DELAY_MS;
  }
};
```

Désactivé par défaut (`false`). Ne peut s'activer que si les trois portes (modèle, webOS ≥ 6 via SDK, abonnement ≥ 2 flux) sont ouvertes **et** que `shouldActivate` le permet côté UI.

**Branchement Xtream (amendement V9) :** pour une source Xtream (§6.5), `provider.maxConcurrentStreams` est alimenté par `user_info.max_connections` reçu via le message `ACCOUNT_INFO` (routé `_routeAux` → listener enregistré par le module Dual Player). `max_connections` absent ou < 2 → la porte reste fermée (comportement sûr par défaut, XP-3/XP-4).

---

## 8. UI — FocusEngine (wiring complet) & VirtualList (virtualisation réelle)

### 8.1 FocusEngine

```javascript
// src/ui/FocusEngine.js
export class FocusEngine {
  constructor() {
    this._destroyed = false;
    this.focusableElements = [];
    this.currentIndex = -1;
    this.lastMouseX = -1;
    this.lastMouseY = -1;
    this.threshold = 5;          // hystérésis gyroscope Magic Remote (px)
    this.backHandlers = [];      // pile LIFO : modal > OSD > …

    // Listeners nommés et liés — retire-ables au destroy (Invariant §1.2-4)
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnMouseMove = this.handleMouseMove.bind(this);
  }

  init() {
    if (this._destroyed) return;
    window.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('mousemove', this.boundOnMouseMove);
  }

  setFocusables(elements) {
    this.focusableElements = elements || [];
    if (this.currentIndex >= this.focusableElements.length) {
      this.currentIndex = this.focusableElements.length - 1;
    }
  }

  handleMouseMove(e) {
    if (this._destroyed) return;
    if (this.lastMouseX === -1) { // première mesure : initialiser sans activer
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }
    const deltaX = Math.abs(e.clientX - this.lastMouseX);
    const deltaY = Math.abs(e.clientY - this.lastMouseY);
    if (deltaX < this.threshold && deltaY < this.threshold) return; // micro-tremblements gyro
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    document.body.classList.add('magic-remote-active');
  }

  handleKeyDown(e) {
    if (this._destroyed) return;
    document.body.classList.remove('magic-remote-active');

    switch (e.keyCode) {
      case 37: this.navigate(-1); break; // Left
      case 38: this.navigate(-1); break; // Up   (liste verticale)
      case 39: this.navigate(1);  break; // Right
      case 40: this.navigate(1);  break; // Down
      case 13:                         // OK / Entrée webOS
        e.preventDefault();
        this.activateCurrent();
        break;
      case 461:                        // Back webOS
        e.preventDefault();
        this.handleSystemBack();
        break;
      default: break;
    }
  }

  // Un <div tabindex="-1"> ne déclenche AUCUN click natif sur Entrée (contrairement
  // à <button>/<a>) : l'activation D-Pad passe par ce canal explicite. L'activation
  // au pointeur Magic Remote, elle, reste un click natif géré par les composants.
  activateCurrent() {
    const el = this.focusableElements[this.currentIndex];
    if (!el) return;
    const attr = el.getAttribute('data-index');
    const parsed = attr !== null ? parseInt(attr, 10) : NaN;
    window.dispatchEvent(new CustomEvent('focus-activate', {
      detail: { element: el, index: isNaN(parsed) ? this.currentIndex : parsed }
    }));
  }

  navigate(direction) {
    const count = this.focusableElements.length;
    if (count === 0) return;
    this.currentIndex = (this.currentIndex + direction + count) % count;
    const el = this.focusableElements[this.currentIndex];
    if (el && typeof el.focus === 'function') el.focus();
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' }); // supporté Chromium 68
    }
  }

  // Pile de retour : chaque modal/OSD pousse un handler, le dépile à sa fermeture
  pushBackHandler(fn) { this.backHandlers.push(fn); }
  removeBackHandler(fn) {
    const i = this.backHandlers.indexOf(fn);
    if (i !== -1) this.backHandlers.splice(i, 1);
  }

  handleSystemBack() {
    if (this.backHandlers.length > 0) {
      this.backHandlers[this.backHandlers.length - 1]();
      return;
    }
    // Plus rien à fermer : rendre la main à webOS (menu Home / sortie d'app)
    if (window.webOS && typeof window.webOS.platformBack === 'function') {
      window.webOS.platformBack();
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('mousemove', this.boundOnMouseMove);
    this.focusableElements = [];
    this.backHandlers = [];
  }
}
```

### 8.2 VirtualList — windowing réel (astreinte §1.2-6)

```javascript
// src/ui/VirtualList.js
import { BaseComponent } from '../core/BaseComponent.js';

export class VirtualList extends BaseComponent {
  constructor(container, options) {
    super();
    options = options || {};
    this.container = container;
    this.itemHeight = options.itemHeight || 60;
    this.overscan = options.overscan != null ? options.overscan : 4;
    this.items = [];
    this.pool = [];              // nœuds DOM recyclés — jamais > _maxNodes()
    this.rafPending = false;

    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';

    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    this.spacer.style.width = '100%';
    this.container.appendChild(this.spacer);

    this.boundOnScroll = this._onScroll.bind(this);
  }

  mount() {
    if (this._destroyed) return;
    this.container.addEventListener('scroll', this.boundOnScroll);
    this._renderWindow();
  }

  setItems(items) {
    if (this._destroyed) return;
    this.items = items || [];
    this.spacer.style.height = (this.items.length * this.itemHeight) + 'px';
    this._renderWindow();
  }

  _onScroll() {
    if (this.rafPending || this._destroyed) return;
    this.rafPending = true;
    const self = this;
    requestAnimationFrame(function () {
      self.rafPending = false;
      self._renderWindow();
    });
  }

  _maxNodes() {
    const h = this.container.clientHeight || 720;
    return Math.ceil(h / this.itemHeight) + 2 * this.overscan + 1; // invariant §1.2-6
  }

  _renderWindow() {
    if (this._destroyed) return;
    const scrollTop = this.container.scrollTop;
    const h = this.container.clientHeight || 720;
    const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
    const end = Math.min(this.items.length, Math.ceil((scrollTop + h) / this.itemHeight) + this.overscan);
    const needed = Math.min(end - start, this._maxNodes());

    while (this.pool.length < needed) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.tabIndex = -1; // focusable par FocusEngine sans tabulation native
      const style = row.style;
      style.position = 'absolute';
      style.top = '0';
      style.left = '0';
      style.right = '0';
      style.height = this.itemHeight + 'px';
      style.willChange = 'transform';
      const title = document.createElement('span');
      title.className = 'channel-title';
      row.appendChild(title);
      this.spacer.appendChild(row);
      this.pool.push(row);
    }

    for (let k = 0; k < this.pool.length; k++) {
      const rowEl = this.pool[k];
      const i = start + k;
      if (i < end) {
        rowEl.style.display = '';
        rowEl.style.transform = 'translateY(' + (i * this.itemHeight) + 'px)';
        rowEl.setAttribute('data-index', String(i));
        const item = this.items[i];
        // Rendu XSS-safe strict : textContent, jamais innerHTML (Invariant §1.2-3)
        rowEl.firstChild.textContent = String((item && item.name) || 'Chaîne ' + (i + 1));
      } else {
        rowEl.style.display = 'none';
      }
    }
  }

  // Sondage pour test d'invariant : doit toujours être <= _maxNodes()
  getRenderedNodeCount() {
    return this.pool.length;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.container.removeEventListener('scroll', this.boundOnScroll);
    while (this.spacer.firstChild) this.spacer.removeChild(this.spacer.firstChild);
    if (this.spacer.parentNode) this.spacer.parentNode.removeChild(this.spacer);
    this.pool = [];
    this.items = [];
  }
}
```

L'UI notifie `FocusEngine.setFocusables(...)` après chaque `_renderWindow()` significatif avec les lignes **visibles** (pool), la navigation clavier pilote `container.scrollTop`.

### 8.4 Télécommande — routage contextuel unifié (ajout V12)

Le module `src/ui/RemoteKeys.js` (logique **pure**, table classifiée par
contexte) est branché sur `window keydown` AVANT le FocusEngine — le moteur
§8.1 reste **verbatim**. Un événement est soit consommé (`preventDefault` +
`stopImmediatePropagation`) soit rendu au moteur ; la pile LIFO de back n'est
jamais contournée.

| Priorité de contexte | Règle |
|---|---|
| 1. champ en édition (`INPUT`/`TEXTAREA`/`SELECT` focusés) | flèches natives **jamais volées** ; Entrée dans la recherche = lancer le filtre (`form-enter`) |
| 2. panneau série ouvert | OK = activation native du bouton focalisé ; GAUCHE au niveau épisodes = retour saisons ; Échap/461/STOP = dépile la pile (→ fermer) ; flèches = navigation moteur |
| 3. lecteur ouvert | ↑/↓ et PROG−/PROG+ (412/414) et PageUp/Down = **zap direct** (chaîne précédente/suivante de la LISTE FILTRÉE courante, circulaire, sans sortir au menu) ; 415/448/19 = lecture/pause ; 413/Échap/461 = fermer le lecteur ; 417/419 = ±10 s **uniquement sur flux indexables** (VOD/épisodes, jamais le direct) ; 457 = réafficher l'OSD |
| 4. liste (live/vod/series) | ↑/↓ pas de ligne circulaire ; ←/→ et 33/34 **page entière** circulaire ; OK/PLAY/PROG+ = activer ; 402 = onglet Playlistes (jamais de cul-de-sac au clavier) ; onglet playlists = moteur seul |

Gardes : **anti-tempête de répétition** par type d'action (45 ms mouvement,
130 ms zap — le TV répète à ~30 ms en maintien ; horloge injectable, testée) ;
zap et pages sont **circulaires** (pas de butée muette). La **Magic Remote**
active aussi les lignes de liste (délégation `click` au niveau du scroller,
les nœuds du VirtualList étant recyclés — jamais de listener par ligne).
L'activation clavier des boutons passe par le consommateur `focus-activate`
(§8.1) qui déclenche `.click()` sur l'élément focalisé : corrige l'Entrée sur
tout bouton d'overlay ou de formulaire, que le moteur empêchait auparavant.

---

## 9. Tests d'Import & Stratégie de Recette (Sprint 0 → CI)

Les défaillances historiques (fin de flux, purge croisée, fuseau horaire) sont **invisibles au build et au smoke test** : la recette s'appuie sur des fixtures à assertions exactes.

**Progression d'import (ajout V10/V16/V17/V17.1, contrat d'événements additifs)** : `ImportController.startImport` émet `import-start {importId, kind, profileId, profileLabel}` ; le worker Xtream émet `IMPORT_PHASE {importId, playlistId, phase, label}` dès l'authentification puis aux phases catégories/catalogue/écriture, routé en `import-phase` par le `DataManager` ; la pompe réseau émet `import-meta {importId, bytesTotal}` dès que `Content-Length` est connu, puis `import-progress {importId, bytesDone}` (throttle ≥ 1 % ou 256 Ko) ; à la fin réussie, `ImportController` émet `import-finished {importId, elapsedMs, profileId, profileLabel}` ; le `DataManager` émet `import-rows {importId, written, targetTable}` après chaque CHUNK écrit, et route `IMPORT_META` du worker Xtream en `import-meta {importId, totalItems}`. Le **badge d'import** (composant non interactif, hors focus D-pad, `aria-live="polite"`) affiche : pourcentage de lignes si `totalItems` connu (mode global Xtream), sinon pourcentage d'octets si `Content-Length` connu (M3U/XMLTV), sinon barre indéterminée animée (repli par catégorie, réponse sans longueur) ; fin sur `import-complete` (« ✔ terminé — n lignes »), puis durée/profil sur `import-finished` (« ✔ terminé — n lignes · s s · profil »), `import-error` (message rouge), `import-aborted`. Les événements sont purement additifs : aucun consommateur ne change le protocole §5.2/§5.8, et la suppression du badge ne peut régresser l'import.

| Fixture | Contenu | Assertion obligatoire |
|---|---|---|
| `xtream-series` (V11/V15) | panneau mock : 2 catégories de séries (3+2 entrées), `get_series_info` en **trois formes** (seasons legacy + entries aplati + `episodes` Xtream standard avec `episode_num`) | 5 lignes `series`, `groupName` issu de la Map serveur, trois réponses normalisées en saisons/épisodes lisibles (n°/id/extension triés) ; réimport = swap + purge `series`/`series_info`/`categories` de l'ancien import uniquement |
| `xtream-categories` (V11) | catégories live/vod/series dans un ordre **non alphabétique** | `db.categories` dans l'ordre serveur exact, `sort` = index ; idempotence par `(importId, kind)` ; jamais écrites via CHUNK |
| `m3u-categories` (V11) | groupes répétés + un item sans groupe | ordre de première apparition du fichier ; `Autres` présent ; `CATEGORIES` émis avant `COMPLETE` |
| `series-info-cache` (V11) | fetch espionné | 1 appel réseau pour 2 ouvertures ; TTL expiré → refetch ; HTTP 404/JSON invalide/réseau KO → **rien en cache**, erreur typée, import intact |
| `list-order` (V13) | catalogue Xtream entrelacé (stream_id non croissants, catégories mêlées) + M3U à groupes alternés + panel replié (failGlobal) | `PlaylistManager.channels/vod/series` rendus en (rang catégorie, sortIdx) **identiques en mode global et en repli** ; ordre lexicographique des clés **jamais** observable ; tri pur immuable |
| `remote-keys` (V12) | table de classement pure (chaque keyCode × chaque contexte), `stepIndex`/`pageIndex`, gate à horloge injectée | aucun vol de touche dans les champs ; zap/OK/PROG mappés en lecteur ; pages circulaires ; gate : 20 ms avalé / 46 ms passe / compteurs indépendants par type |
| `media-startup-fhd` (V14) | adaptateur avec fenêtre d'inactivité courte injectée : `NETWORK_LOADING`, `FRAG_LOADING` avant `FRAG_LOADED`, silence, progression sans `playing` | aucun faux fallback/`STARTUP_FAILURE` pendant une requête active ; silence terminal échoue ; plafond absolu échoue même si les marqueurs continuent ; événements natifs réarment |
| `default-playlist` (V16) | boot sur DB vide puis second boot | playlist Xtream par défaut créée une seule fois, sélectionnable, aucune saisie nécessaire pour atteindre Importer |
| `import-phases` (V16) | worker Xtream avec trois catalogues globaux | phases `auth`/`categories`/`catalogue`/`write-*` visibles avant et pendant `IMPORT_META`, total et écritures inchangés ; catalogues lancés en parallèle |
| `import-profiles` (V17) | cinq profils Xtream, dont `bulkAdd`, lots réduits dans le test Node et UI réelle contre panel mock | les cinq paramètres sont propagés ; `bulkAdd` écrit les trois tables puis swappe ; badge = profil + durée ; boutons visibles uniquement sur Xtream |
| `quota-cleanup` (V17.1) | staging partiellement écrit puis erreur `QuotaExceededError`, avec un import actif distinct | les lignes de l'import échoué sont supprimées dans toutes les tables, l'actif reste intact ; un nouvel import nettoie aussi les reliquats `failed` historiques |
| `m3u-20000.m3u` | 20 000 chaînes, 40 groupes | 20 000 lignes en base ; `activeImportId` permuté ; groupes paginables par `[importId+groupName]` |
| `xmltv-644.xml` | 644 programmes | **exactement 644 lignes** `epg` ; `COMPLETE` reçu ; `status: 'completed'` |
| `xmltv-500-exact.xml` | 500 programmes | terminaison correcte (bord de modulo) |
| `xmltv-offsets.xml` | dates `+0100`, `-0500`, sans offset | écarts horaires exactement appliqués (±1 h / −5 h) |
| `xmltv-dates-12.xml` | dates à 12 chiffres (sans secondes) | parsées (secondes = 00), **non** ignorées silencieusement |
| `xmltv-attrs.xml` | `>` littéral dans valeurs quotées, quotes simples, ordre d'attributs inversé | tous les programmes capturés |
| `xmltv-cdata.xml` | titres en CDATA, entités, quotes simples | titres propres, sans wrapper CDATA ni entités |
| `xmltv-coupe.xml` | fichier servi en chunks de 7 Ko (frontières arbitraires) | zéro programme perdu vs référence |
| `duo-playlists.m3u` | 2 playlists importées en séquence | l'import B **ne supprime aucune** ligne de la playlist A |
| Double déclenchement | deux `startImport` quasi simultanés | second rejeté (`import-busy`, PROT-6), premier import intact |
| Abort en cours | `ABORT_IMPORT` à ~50 % | pas de swap, `status: 'failed'`, worker débloqué, boot suivant sans orphelins |
| Abort pendant watermark | abort pendant slot plein (4 chunks en vol) | promesse d'import rejetée (`IMPORT_ABORTED`), aucun waiter suspendu résiduel |
| `xtream-mock.json` | panel simulé : 2 catégories live (3 + 2 streams), 1 catégorie vod (4 films), `max_connections: 2` | comptes exacts : 5 `channels` + 4 `vod` ; `ACCOUNT_INFO` reçu ; `provider.maxConcurrentStreams === 2` |
| `xtream-auth-fail.json` | `user_info.status: "Expired"` | `import-error` `XTREAM_AUTH_FAILED`, zéro écriture en base, pas de swap |

Ces tests roulent headless (Vite + navigateur contraint) ; le smoke test Chromium 68 (§2.2) gate la livraison du Sprint 0.

---

## 10. Feuille de Route des Sprints

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 0 : Infra Vite, appinfo, CapabilityDetector (SDK + timeout),          │
│            smoke test Chrome 68 (syntaxe des deps incluse)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 1 : db.js (schéma final §5.1), m3u.worker.js, DataManager complet,    │
│            fixtures d'import §9, reprise sur crash, purge boot               │
├──────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 2 : MediaAdapter matrice complète, Watchdog, LifecycleAdapter         │
│            (sauvegarde + restauration + urlResolver), urlResolver tokens     │
├──────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 3 : FocusEngine (binds + pile Back), VirtualList windowing,           │
│            main.css, invariant nœuds testé sur 20 000 items                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 4 : epg.worker.js complet, DualPlayerPolicy, qualif TV réelle §11,    │
│            drop_console → true (build store), fixtures EPG §9                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Protocole de Qualification sur Téléviseur Réel (LG webOS 5.0, entrée de gamme)

**Test T1 — Zapping intensif & VPU :** 50 changements de chaîne à 500 ms d'intervalle. Succès : aucun crash du processus, pas de gel décodeur, heap JS stable après GC. **Pendant la lecture en cours : bouton Home (veille)** → succès : retour à l'app avec **reprise du flux** (§7.4), pas de kill OS.

**Test T2 — Soak mémoire 4 h :** Live continu + refresh EPG en arrière-plan. Succès : heap JS ≤ **+20 %** vs post-initialisation, plateau confirmé sur relevés toutes les 30 min.

**Test T3 — Fluide UI 60 FPS :** défilement rapide (D-Pad maintenu) dans 20 000 chaînes **pendant un import EPG**. Succès : 60 FPS soutenus, aucune tâche main thread > 50 ms (vérifié au profiler ; le backpressure + respiration existent précisément pour ce critère).

**Test T4 — Déterminisme réseau :** coupure câble 5 s → reprise automatique sans intervention (`RECOVERING` ×1) ; coupure 20 s → `ERROR` propre après épuisement du retry + watchdog ; réponse 403 sur flux → `ERROR` immédiat, **aucun retry** observable.

---

## 12. Hors Périmètre Déclaré (v1.0)

Non implémentés dans cette roadmap et **à ne pas introduire spontanément** (cf. règle d'exécution principale) : DRM (Widevine) ; pistes multi-audio et sous-titres ; touches CH+/CH− et pavé couleurs ; timeshift / catch-up / enregistrement ; multi-profil utilisateur. Toute demande de l'un de ces périmètres = réouverture de spécification.

> **Arbitrage produit à valider avec le métier (DRM)** : l'exclusion Widevine restreint l'application aux flux non protégés (serveurs M3U/EPG classiques). Une part significative de l'IPTV *commerciale* (catch-up de chaînes, bouquets payants) exige Widevine via EME — hls.js le supporte, et le pipeline natif webOS aussi. Si le produit vise ces catalogues, le DRM bascule de « hors périmètre » à « Sprint 5 dédié » (licence serveur + `MediaKeys` + politique de fallback). Décision à acter par écrit avant gel commercial.

---

## 13. Matrice de Traçabilité des Corrections (V3 → V6)

| Défaut historique | Version de détection | Correction V6 | § |
|---|---|---|---|
| Regex UA pour version webOS (inopérante) | V3-C1 | `deviceInfo().sdkVersion` + tuple + timeout 1 s + double chemin d'import | §3 |
| Frontière de chunk XML (programmes perdus) | V3-C2 | tampon `carryOver` + `lastIndexOf('</programme>')` | §6 |
| Backpressure absent du worker EPG | V3-C3 | handshake `isWaitingForAck` + ack filtré par `importId` | §6, PROT-1/2 |
| `iife` + workers/code-splitting | V3-M1 | `worker.format: 'iife'` + `inlineDynamicImports: true` | §2.2 |
| Respiration rAF = deadlock en arrière-plan | V3-M2 | branche `document.hidden → setTimeout(16)` | §5.3 |
| Idempotence / Watchdog rafales / sérialisation | V3-M3 | flags `_destroyed` généralisés ; `fired` one-shot ; `processingQueue` chaînée | §1.2, §5.3, §7.3 |
| appinfo minimal | V3-M5 | `largeIcon`, `resolution`, `disableBackHistoryAPI`, `bgColor` | §4 |
| `COMPLETE` jamais émis + reste final perdu | V4-R1/R1b | `END_OF_STREAM` + force-flush propagé par `isStreamEnded` dans l'ack | §6, PROT-3/4 |
| Purge cross-playlist destructive | V4-R2 | transaction bornée `playlistId` + `kind`, `anyOf(oldImports)` | §5.3 |
| Fuseau horaire XMLTV ignoré | V4-R3 | `parseXMLTVDateToUTC` avec offset `±HHMM`, dates invalides → skip | §6.3 |
| Erreur DB = backpressure figé | V4-R4 | `ABORT_IMPORT` + acquittement sans écriture + `status:'failed'` sans rejet secondaire | §5.3, PROT-5 |
| Bootstrap figé si SDK muet | V4-R5 | `Promise.race` 1 000 ms → baseline 5.0 | §3 |
| Deadlock du reste final (< 500 après lot plein) | V5-B1 | `flushPendingItems(isStreamEnded)` dans le handler d'ack | §6.2 |
| Clés `id` sans stratégie / index régressés | V5-B2 | règle DB-1 (clés applicatives déterministes) + schéma restauré `[importId+groupName]`, `[importId+channelId+startTime]`, `searchName` | §5.1 |
| Fallback natif uniquement sur rejet de `play()` | V5-B3 | listener `error` videoEl + timeout startup 10 s + matrice de décision complète | §7.1–7.2 |
| Pas de reprise après veille / destroy non flaggé | V5-B4 | `savedState` + `_restore()` + `urlResolver` + flags partout | §7.4 |
| `VirtualList` non virtualisée | V5-B5 | windowing + pool recyclé + invariant de bornage §1.2-6 | §8.2 |
| FocusEngine : listener anonyme, `keydown` non enregistré | V5-B6 | binds nommés, `init()` complet, `destroy()`, pile Back LIFO | §8.1 |
| `.catch` DataManager rejetant | V5-B7 | `_handleTerminalError` sans `await` nu, tout secondaire en try/catch | §5.3 |
| Backpressure réseau non bouclé | V5-B8 | watermark 4 chunks texte via `CHUNK_PARSED` | §5.7 |
| Titres multilingues / hors-scope non déclarés | V5-B9/B10 | hypothèses WARNING §6.4 ; périmètre exclu §12 | §6.4, §12 |
| Qualification non quantifiée | V3-m9 | T1–T4 avec seuils chiffrés (+ reprise après veille explicitée) | §11 |
| Absence de fixtures | V3-m11 | suite de recette à assertions exactes §9 | §9 |
| Lecteur réseau/watermark décrit en prose sans code | Revue V6 n°1 | `ImportController` complet + routage `CHUNK_PARSED` + fermeture des deadlocks de complétion et d'abort | §5.7–5.8 |
| Entrée/OK (keyCode 13) non câblée sur divs focusables | Revue V6 n°2 | `case 13` → `activateCurrent()` + événement `focus-activate` | §8.1 |
| `>` littéral en attribut / dates 12 chiffres non documentés | Revue V6 n°3 | regex balise durcie + secondes optionnelles + WARNINGs actés | §6.1, §6.3, §6.4 |
| Branche NATIVE morte dans `_tryRecover` | Revue V6 n°4 | reconnexion intra-moteur rétablie (taxonomie V3) + timeout bornant aussi `RECOVERING` + gestion `error` en `RECOVERING` | §7.1–7.2 |
| Double import concurrent sans garde | Revue V6 n°5 | invariant PROT-6 : rejet `import-busy` + consigne UI + fixture dédiée | §5.2, §5.8, §9 |
| Exclusion DRM sans conséquence métier actée | Revue V6 produit | arbitrage écrit : flux non protégés en v1.0, sinon Sprint 5 dédié | §12 |
| Filet `worker.onerror` câblé sans `importId` (promesse d'import jamais résolue) | Revue V7-A | méthode publique `failImport(importId, err)` + injection explicite de l'import courant au bootstrap + recréation du worker après crash (`workerFactory`) | §3, §5.3, §5.8 |
| Budget de reconnexion partagé NATIVE/HLS_MSE (résilience asymétrique selon le chemin d'arrivée) | Revue V7-B | `recoveries = 0` dans `_fallbackToHls` : budget frais **par moteur**, fidèle à la taxonomie V3 ; borné (≤ 2 reconnexions + 1 fallback par session) | §7.1–7.2 |
| Fenêtre zombie d'1 s du timer de reconnexion | Revue V7-nitpick | `recoveryTimer` annulé dans `_teardownPlayback()` ; confirmation terrain au test T4 | §7.2, §11 |
| Sources d'import limitées à M3U/XMLTV (pas de serveur Xtream) | Demande produit → V9 | `XtreamClient` + `xtream.worker.js` (§6.5) : auth par URL/username/password, pagination par catégorie, table `vod` (DB-5, Dexie v1→v2), purge généralisée, `max_connections` → DualPlayer, fixtures mock | §5.1, §5.3, §5.8, §6.5, §7.5, §9 |
| Import par défaut de `webostvjs` invalide (paquet sans export ESM) | Build Sprint 0 (Rollup : « "default" is not exported ») | §3 corrigé V9.1 : `import 'webostvjs'` (effet de bord) + accès `window.webOS` uniquement ; timeout/SDK inchangés | §3 |
| CHUNK en vol après `abort()` utilisateur écrit quand même (contradiction PROT-5) | Test d'abort Sprint 1 | `ImportController.abort()` marque `dataManager.abortedImports` avant `ABORT_IMPORT` ; `PlaylistManager.abort()` solde `status:'failed'` + purge les lignes partielles | §5.2 (PROT-5), §5.8, §9 |
| Respiration d'import en attente d'un `requestAnimationFrame` nu : gel de la file d'écriture si le thread UI ne produit aucune frame (variantes extrêmes : VPU TV saturé, harnais headless « paint-idle ») | Harnais navigateur §9 (test lourd H9 sous chrome-headless-shell : timeout 240 s) | §5.3 corrigé V9.1 : respiration = **course rAF contre plafond 32 ms** (`setTimeout`), gagnant libère l'autre ; sur TV à 60 fps le plafond ne se déclenche pas — sémantique identique (rendu prioritaire, jamais de gel). H9 vert : 20 000 lignes en 2,7 s, pire intervalle rAF 47 ms | §5.3 |

| Goulot de vitesse d'import Xtream : une requête HTTP séquentielle par catégorie (mesuré : 900 catégories ≈ 74 s à RTT 80 ms, minutes au salon) | Analyse perf 2026-09-10, validée produit (option A) | §6.5 révisé V10 : mode « catalogue global » par défaut (1 requête par type + Map catégories locale), repli automatique par catégorie si échec ou réponse > 40 Mo ; message `IMPORT_META` pour la progression | §6.5, §5.8, §9 |
| Coût fixe par chunk d'écriture (55 ms mesurés dont ~40 % de respiration/IPC, pas de travail utile) | Analyse perf 2026-09-10, validée produit (option C) | `CHUNK_ITEMS` porté de 500 à 2000 dans les trois workers ; sémantique PROT-1 (un seul CHUNK en vol) et transactions bulkPut inchangées ; M3U 60 k mesuré 6,6 s → ≈ 4 s attendu | §5.2, §5.3, §6.5 |
| Progression d'import invisible (l'écran d'attente ne dit ni où ni combien) | Demande produit 2026-09-10 | Événements `import-start`/`import-meta`/`import-progress`/`import-rows` additifs (§5.8, §5.3) + badge d'import §9 (pourcentage lignes si `totalItems` connu, sinon pourcentage d'octets si `Content-Length` connu, sinon indéterminé animé) ; aucune interaction D-pad, hors focus | §5.8, §9 |
| Séries totalement absentes du produit (demande explicite) ; parcours Chaînes/Films/Séries sans catégories structurées | Demande produit 2026-09-10 (V11) | §6.6 ajouté : import `get_series` (global + repli, même protocole), détail `get_series_info` **paresseux** + cache `series_info` TTL 24 h, lecture `/series/{u}/{p}/{ep}.{ext}` ; §5.1 : DB-6 (v1→v3 additif) ; les séries M3U n'existent pas (table vide, pas d'erreur) | §5.1, §6.5, §6.6, §9 |
| Catégories connues par `groupName` dérivé des items (ordre alphabétique UI, catégories vides invisibles) | Demande « organise en catégories définies par le serveur » (V11) | Message additif `CATEGORIES` (worker → DataManager → table `categories`, ordre serveur exact, y compris en repli) ; `<select>` par liste branché sur `db.categories`, filtre avant recherche ; M3U : ordre de première apparition des group-title | §6.4, §6.5, §5.1, §6.6 |

| Sélection d'épisode en liste plate (saisons mélangées) ; télécommande sous-exploitée (ni zap, ni play/pause, ni page) ; changer de chaîne imposait de fermer le lecteur | Demande produit 2026-09-10 (V12) | §6.6 navigation saison→épisode (saison unique = niveau sauté) + zap épisode ; §8.4 ajouté : routeur contextuel RemoteKeys (zap ↑/↓ + PROG± dans le lecteur, playpause 415, seek ±10 s sur flux indexables, INFO 457, HOME 402, pages circulaires, gate anti-répétition, click Magic Remote sur lignes, consommateur `focus-activate` qui répare l'Entrée sur les boutons) | §6.6, §8.1 (note), §8.4, §9 |


| `get_series_info` réel renvoie `episodes` dictionnaire par saison avec `episode_num` au lieu de `seasons`/`entries` | Trace utilisateur : « aucun épisode fourni par le panneau » (V15) | `SeriesBrowser.normalize` accepte la forme Xtream standard `{episodes:{"1":[…]}}`, conserve les numéros de saison, mappe `episode_num` vers `episodeId`, conserve `id` pour l'URL `/series/` ; cache V11 invalidé par `formatVersion`, fixture + E2E mock standard | §6.6, §9 |
| Faux `STARTUP_FAILURE: startup timeout 10000ms` sur chaînes FHD pourtant en transfert (`.m3u8` 200/302 puis `.ts` ~3 Mo) | Trace utilisateur TV du 2026-09-10 | V14 §7.2.1 : 10 s = fenêtre sans progression ; événements média + hls.js ; `NETWORK_LOADING`/`FRAG_LOADING` actifs réarment ; plafond absolu 45 s ; tests `media-startup-fhd` | §7.1, §7.2, §7.2.1, §9 |
| Temps silencieux avant le premier pourcentage et catalogues Xtream demandés séquentiellement ; import obligeant à ressaisir base/identifiants | Retour utilisateur webOS 26 + demande playlist par défaut (V16) | `IMPORT_PHASE` immédiat dans le badge ; appels globaux Live/VOD/Séries parallélisés, écriture conservée séquentielle ; `DEFAULT_PLAYLIST` + `ensureDefaultPlaylist` idempotent au boot, sans auto-import | §5.8, §6.5, §6.7, §9 |
| Ralentissement surtout visible pendant « Écriture des films », « Écriture des séries » et à 99 % sur les derniers lots ; besoin de comparer sur TV réelle | Demande produit 2026-09-11 (V17) | cinq boutons `Test import 1…5` sur Xtream ; tailles 2 000/4 000/8 000, `bulkPut` ou `bulkAdd`, respiration 32/16/0/8 ms, catalogues parallèles ou séquentiels ; protocole/swap/protections inchangés ; `import-finished` expose durée + profil ; aucun mot de passe journalisé | §5.2, §5.3, §5.8, §6.8, §9 |
| `QuotaExceededError` après plusieurs tests, avec risque de conserver les lots partiels des imports échoués | Retour utilisateur 2026-09-11 (V17.1) | purge immédiate du staging par `importId` dans `DataManager.failImport` ; nettoyage des anciens `failed` avant tout nouvel import ; import actif préservé ; message public `STORAGE_QUOTA` si la capacité physique reste insuffisante | §5.3, §6.9, §9 |
**Statut : spécification gelée pour exécution (V9 + V9.1 ; V10 perf ; V11 séries & catégories ; V12 télécommande & séries deux temps ; V13 ordre serveur des listes et du zap ; V14 démarrage FHD tolérant ; V15 normalisation Xtream réelle de `get_series_info` ; V16 phases d'import visibles, catalogues Xtream parallélisés et playlist par défaut idempotente ; V17 profils de benchmark Xtream, lots/écriture/respiration configurables et mesure de durée ; V17.1 purge du staging après quota/échec et nettoyage des reliquats `failed`). Toute divergence ultérieure = nouvelle révision incrémentale (V18) avec entrée de traçabilité).**
