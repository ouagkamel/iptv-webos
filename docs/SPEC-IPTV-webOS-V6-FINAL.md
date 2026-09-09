# SPÉCIFICATION TECHNIQUE D'EXÉCUTION & ARCHITECTURE — V9 (AMENDEMENT XTREAM CODES)

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
```

**Règle DB-5 (Xtream) :** la VOD Xtream vit dans `vod` (jamais dans `channels`) ; clés applicatives `id = importId + ':' + xtreamStreamId` ; index identiques en esprit à `channels` (pagination par catégorie, recherche). Un import `kind: 'playlist'` issu d'Xtream écrit **channels (live) ET vod (films)** — la purge bornée §5.3 couvre les deux tables.

**Règle de clés (invariant DB-1) — qui génère quoi :**
- `playlists.id`, `imports.id` : auto-incrémentés (`++id`), créés une seule fois via la couche applicative.
- `channels.id` : **chaîne applicative déterministe `${importId}:${seq}`**, générée par le worker à l'émission de chaque item (`seq` = compteur incrémental dans le fichier). Ce schéma rend `bulkPut` idempotent (un re-téléchargement recrée les mêmes clés → écrasement, pas de doublons).
- `epg.id` : **chaîne applicative `${importId}:${channelId}:${startTime}`** — déduplication naturelle des programmes identiques réémis lors d'un refresh EPG.

**Règle DB-2 — index :** `[importId+groupName]` sert la pagination par groupe ; `searchName` sert la recherche (`startsWith`) ; `[importId+channelId+startTime]` sert la requête EPG chronologique (`between([imp, ch, t0], [imp, ch, t1)])`) ; `stopTime` (seul) sert la purge d'expiration. `logo` et `streamUrl` ne sont **jamais indexés** (coût d'écriture et disque sans cas d'usage).

**Règle DB-3 — normalisation recherche :** `searchName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')` — calculé côté worker.

**Règle DB-4 — séparation des types d'import :** `imports.kind ∈ { 'playlist', 'epg' }`. Un import de playlist écrit dans `channels` et met à jour `playlists.activeImportId` ; un import EPG écrit dans `epg` et met à jour `playlists.activeEpgImportId`. La purge d'un type ne touche **jamais** la table de l'autre (cf. §5.4).

### 5.2 Protocole d'Import Commun (workers M3U et EPG)

```
Main Thread                              Worker
    │  INIT_IMPORT {importId, playlistId, kind}  ▶
    │                                            │  (état interne réinitialisé)
    │  PARSE_CHUNK {importId, chunk}   ────────▶ │  parsing + accumulation
    │  ◀────────  CHUNK_PARSED {importId}        │  (ack de parsing : pilotage réseau, §5.7)
    │  ◀────────  CHUNK {importId, items, table} │  ≤ 500 items, worker suspendu
    │  bulkPut → respiration UI                  │
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
- PROT-4 : **les restes partiels (< 500) sont drainables après chaque ack une fois le flux terminé** — le handler d'ack force le flush avec l'état `isStreamEnded`. *(C'est la correction du deadlock de fin de flux : sans cette règle, tout import dont le total résiduel après dernier lot plein est < 500 ne termine jamais.)*
- PROT-5 : en cas d'`ABORT_IMPORT`, le main thread continue d'acquitter (`CHUNK_COMMITTED`) les lots déjà reçus **sans les écrire**, afin de ne jamais laisser le worker suspendu — l'import est marqué `status: 'failed'`.
- PROT-6 : **un seul import en vol par worker** (son état interne est singleton). Un second déclenchement est rejeté par l'ImportController (événement `import-busy`, promesse rejetée). L'UI désactive le contrôle d'import pendant toute la durée de l'opération.

### 5.3 DataManager (file sérialisée, respiration, erreur terminale sans rejet secondaire)

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

  async _processChunk({ importId, items, targetTable }) {
    // PROT-5 : acquitter sans écrire si l'import a été avorté
    if (this.abortedImports.has(importId)) {
      this.worker.postMessage({ type: 'CHUNK_COMMITTED', importId });
      return;
    }

    await db[targetTable || this.targetTableDefault].bulkPut(items);

    // Respiration UI compatible arrière-plan :
    // rAF est suspendu par webOS quand document.hidden === true → setTimeout obligatoire,
    // sinon l'import se fige jusqu'au retour au premier plan.
    // Correction V9.1 (harnais headless ; protège aussi la TV quand les frames sont
    // starvées sous charge VPU) : race rAF / plafond 32 ms — la respiration ne peut
    // plus jamais bloquer l’import sur une frame absente ; borne renforcée, pas relâchée.
    await new Promise(resolve => {
      if (document.hidden) {
        setTimeout(resolve, 16);
      } else {
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        var cap = setTimeout(finish, 32);
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
    const chunkToSend = pendingItems.splice(0, 500);
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

Fin de flux avec `pendingItems = 644` : `flushPendingItems(true)` émet 500, `isWaitingForAck = true`. Ack → `flushPendingItems(true)` (car `isStreamEnded`) → émet les 144 restants. Dernier ack → file vide → `checkCompletion()` → `COMPLETE`. **Quel que soit le modulo 500**, la séquence converge — `isStreamEnded` est propagé dans le handler d'ack, c'est la correction décisive.

### 6.3 Cas des dates

`20260906180000 +0100` → `17:00 UTC` ✅ ; `20260906180000 -0500` → `23:00 UTC` ✅ ; `202609061800` (12 chiffres, sans secondes) → secondes = 00, toléré ✅ ; sans offset → interprété UTC (WARNING documenté : certains grabbers omettent l'offset) ; chaîne malformée → item ignoré, jamais de `1970-01-01` en base.

### 6.4 Hypothèses WARNING documentées (§1.1 NIVEAU 2)

- Titres multilingues : premier `<title>` retenu, sans filtrage par `lang`.
- Encodage : UTF-8 obligatoire ; le décodage se fait via `TextDecoder` avec `{ stream: true }` côté main thread (séquences multi-octets coupées entre chunks réseau).
- Balise ouvrante `<programme …>` : la regex tolère un `>` littéral à l'intérieur de valeurs d'attribut **quotées** (légal en XML) ; un attribut **non quoté** (XML invalide) ferait ignorer l'item — détecté par les compteurs des fixtures §9.
- Dates : secondes optionnelles (12 ou 14 chiffres acceptés, secondes = 00) ; toute autre variante (séparateurs, 2 chiffres d'année) → item ignoré, jamais parsé partiellement.
- Le worker M3U (`m3u.worker.js`) implémente **le même protocole** (§5.2) avec tokenisation `#EXTINF`/`#EXTGRP` et génère `id = importId + ':' + seq` + `searchName` normalisé (DB-3).

### 6.5 Import Xtream Codes (URL + username + password) — amendement V9

**État avant amendement :** les seules sources d'import étaient une URL M3U (§5) et une URL XMLTV (§6). Un serveur Xtream *pouvait* déjà être ingéré en « M3U brut » via `get.php?username=…&password=…&type=m3u_plus`, mais sans aucune structure : catégories absentes, VOD indistinguable du Live, aucune information de compte (dont `max_connections`, indispensable au Dual Player §7.5). Cette section ajoute la connexion native à l'API Xtream Codes (`player_api.php`) avec **trois seuls paramètres d'entrée : `base URL`, `username`, `password`**.

**Architecture :**
- `src/platform/XtreamClient.js` (main thread) : constructeur/validateur d'URLs d'endpoints. Stateless, sans effet de bord, jamais de `fetch` ici.
- `src/data/xtream.worker.js` : worker d'import dédié qui **effectue lui-même ses `fetch`** (disponible dans les workers sous Chromium 68), de façon **séquentielle et paginée par catégorie** — chaque réponse est un document JSON complet borné par la taille d'une catégorie : mémoire bornée par la plus grosse catégorie, jamais par le catalogue entier (le carryOver textuel de §6.1 ne s'applique pas aux documents JSON structurés).
- Orchestration : `ImportController.startImport({ source: 'xtream', base, username, password, importId, playlistId, kind: 'playlist' })` (§5.8) — même promesse de complétion, même PROT-6, mêmes événements terminaux.
- Protocole worker identique à §5.2 (`INIT_IMPORT` / `CHUNK` ≤ 500 / `CHUNK_COMMITTED` / `COMPLETE` / `ABORT_IMPORT`) plus deux messages propres : `ACCOUNT_INFO` (routé via `_routeAux` → listeners) et `ERROR` (voie terminale §5.3).

**Endpoints (API Xtream Codes standard) :**

| Rôle | Endpoint |
|---|---|
| Compte (auth + capacités) | `GET {base}/player_api.php?username={u}&password={p}` |
| Catégories Live | `…&action=get_live_categories` |
| Chaînes d'une catégorie | `…&action=get_live_streams&category_id={id}` |
| Catégories VOD | `…&action=get_vod_categories` |
| Films d'une catégorie | `…&action=get_vod_streams&category_id={id}` |
| Lecture Live | `{base}/live/{u}/{p}/{stream_id}.m3u8` |
| Lecture VOD | `{base}/movie/{u}/{p}/{stream_id}.{container_extension}` (défaut `mp4`) |
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

    // 2. Live → channels ; 3. VOD → vod (DB-5) — boucles séquentielles bornées
    if (!aborted) await importCollection('get_live_categories', 'get_live_streams', 'channels', mapLiveItem);
    if (!aborted) await importCollection('get_vod_categories', 'get_vod_streams', 'vod', mapVodItem);

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
| `play()` rejeté / événement `error` natif en state `LOADING` / timeout startup (10 s) | NATIVE | `STARTUP_INCOMPATIBILITY` → **fallback HLS_MSE** |
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

const STARTUP_TIMEOUT_MS = 10000;
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

---

## 9. Tests d'Import & Stratégie de Recette (Sprint 0 → CI)

Les défaillances historiques (fin de flux, purge croisée, fuseau horaire) sont **invisibles au build et au smoke test** : la recette s'appuie sur des fixtures à assertions exactes.

| Fixture | Contenu | Assertion obligatoire |
|---|---|---|
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

**Statut : spécification gelée pour exécution (V9, corrections V9.1 intégrées au Sprint 0). Toute divergence ultérieure = nouvelle révision incrémentale (V10) avec entrée de traçabilité.**
