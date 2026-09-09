# PLAN D'IMPLÉMENTATION — IPTV webOS Player
## Référence opposable : SPEC-IPTV-webOS **V9** (statut « gelée pour exécution », amendement Xtream Codes §6.5)

**Objet :** construire l'application IPTV / VOD / Live pour LG webOS 5.0 (Chromium 68) en suivant strictement la spécification V8 — architecture, stack, nommage des fichiers, invariants et protocoles — sans framework tiers ni refactorisation non demandée (règle d'exécution principale §1).

**Règles opposables rappelées à tout exécutant (humain ou agent IA) :**
- Protocole d'alerte §1.1 : NIVEAU 1 = interruption + décision humaine ; NIVEAU 2 = hypothèse documentée en commentaire d'en-tête.
- Invariants §1.2 : propriété unique de l'erreur · `_destroyed` sur tout `destroy()` · interdiction `innerHTML` sur données de flux · listeners nommés/liés · continuité architecturale (machine d'état à passage unique, VPU, 5 px, qualification) · bornage DOM de VirtualList.
- Protocoles figés : PROT-1…6 (§5.2), DB-1…4 (§5.1), contrat de dates epoch-UTC ms (§5.6/§6.3).
- Build CI : `npm ci` exclusivement ; pin strict des dépendances.

---

## 1. Questions ouvertes (avec hypothèses par défaut — NIVEAU 2 documenté)

| # | Question | Hypothèse par défaut retenue |
|---|---|---|
| Q1 | Assets graphiques (icon.png 80×80, largeIcon.png 400×400) ? | Placeholders générés (fond uni + monogramme), remplaçables sans impact code. |
| Q2 | Accès TV physique webOS 5.0 ? | **Pré-requis bloquant pour la qualification Sprint 4 (§11)** — à fournir par le métier. D'ici là : émulateur webOS TV SDK 5.0 / Chrome 68 headless pour tout le reste, sans substitut possible au T1–T4 officiels. |
| Q3 | Nom de la variable d'environnement store ? | `IPTV_PRODUCTION=true` (adopté ; bascule `drop_console` au Sprint 4, §2.1 note). |
| Q4 | Harness de test ? | **Aucune dépendance ajoutée** : harnais maison `tests/harness.html` + assertions JS, exécuté en Chromium headless réel via le build Vite (`tools/browser-run.mjs`, chrome-headless-shell — 9/9 + smoke 8/8 verts) ; la cible 68 bits est tenue par le gate syntaxe statique + le run émulateur T1 (§9 : « Vite + navigateur contraint »). |

---

## 2. Arborescence cible (noms figés par la spec)

```
package.json                      (§2.1 — contenu exact, zéro ^ ou ~)
vite.config.js                    (§2.2 — worker iife, chrome68, inlineDynamicImports)
appinfo.json                      (§4/§8 — manifeste webOS store-ready)
icon.png, largeIcon.png           (artefacts requis par appinfo.json)
index.html                        (single entry, base './', <video> + conteneur UI)
src/
  bootstrap.js                    (chaîne d'ordonnancement §3 + workerFactory §5.8)
  core/BaseComponent.js           (§1.3)
  utils/CapabilityDetector.js     (§3 : SDK deviceInfo + timeout 1 s)
  data/db.js                      (§5.1 : schéma Dexie v1+v2, règles DB-1…5 — table vod)
  data/DataManager.js             (§5.3 : file sérialisée, failImport, purge channels+vod)
  data/ImportController.js        (§5.8 : pompe réseau, watermark 4, PROT-6, mode xtream)
  data/m3u.worker.js              (§6.4 : protocole §5.2, #EXTINF/#EXTGRP, DB-1/DB-3)
  data/epg.worker.js              (§6.1 : carryOver, fuseaux, PROT-3/4)
  data/xtream.worker.js           (§6.5 : API Xtream paginée par catégorie, XP-1…4)
  media/MediaAdapter.js           (§7.2 : matrice §7.1, requestId, budgets par moteur)
  media/Watchdog.js               (§7.3 : one-shot 8 s)
  media/DualPlayerPolicy.js       (§7.5 : allowlist + SDK version + abonnement)
  platform/LifecycleAdapter.js    (§7.4 : releaseHardware + sauvegarde/restauration)
  platform/XtreamClient.js        (§6.5 : builders/validation d'endpoints, stateless)
  ui/FocusEngine.js               (§8.1 : binds, pile Back LIFO, 13/461)
  ui/VirtualList.js               (§8.2 : windowing, invariant §1.2-6)
  ui/PlayerOverlay.js             (OSD lecture ; consommateur de la pile Back §8.1)
  styles/main.css
tests/
  harness.html, harness-run.js    (harnais §9 en navigateur, cf. Q4 — HARNESS PASS 9/9
                                   sous chrome-headless-shell, H9 lourd inclus)
  *.test.mjs + register.mjs       (harnais node:test — 39/39, fake-indexeddb dev-only)
  fixtures/…                      (§9 : m3u-*, xmltv-*, duo-playlists, xtream-*.json)
dev/
  smoke.html, smoke.js            (smoke Sprint 0 — SMOKE PASS 8/8 en navigateur réel)
tools/
  syntax-gate.mjs                 (gate statique Chromium 68, src + dist filtré contexte)
  browser-run.mjs                 (driver CDP headless : url + sonde → verdict/console)
```

---

## 3. Sprint 0 — Infra, Manifeste & CapabilityDetector

**Objectif :** exécuter un build réel, installable et smoke-testé avant toute logique métier (le smoke test est un **gate** bloquant, §2.2).

| Tâche | Contenu | Réf spec |
|---|---|---|
| 0.1 | `package.json` exact (dexie 3.2.4 · hls.js 1.4.14 · webostvjs 1.2.4 · terser 5.24.0 · vite 4.5.0 ; scripts `dev/build/package`) | §2.1 |
| 0.2 | `vite.config.js` : `worker.format:'iife'`, `target:'chrome68'`, terser `ecma:6`/`drop_console:false`, `inlineDynamicImports:true` | §2.2 |
| 0.3 | `appinfo.json` verbatim (11 propriétés, `requiredMinOSVersion:"5.0.0"`) + placeholders icônes (Q1) | §4/§8 |
| 0.4 | `index.html` minimal : `<video id="player">`, racine UI, chargement module (dev) — le build Vite produit l'IIFE | §2.2 |
| 0.5 | `src/core/BaseComponent.js` verbatim (garde `_destroyed`) | §1.3 |
| 0.6 | `src/utils/CapabilityDetector.js` verbatim (deviceInfo + `Promise.race` 1000 ms + fallback double chemin `window.webOS || webOS`) | §3 |
| 0.7 | `src/bootstrap.js` coquille : `detectAll()` → log du rapport (les étapes DB/worker seront ajoutées au Sprint 1 dans l'ordre §3) | §3 |

**Definition of Done (Sprint 0) :**
- [ ] `npm ci` passe sans divergence de lockfile.
- [ ] `npm run build` produit un unique bundle IIFE + workers IIFE, sans erreur Rollup.
- [ ] `npm run package` produit un `.ipk` installable.
- [ ] **Gate :** chargement headless Chrome 68 (ou émulateur webOS 5.0) → aucune `SyntaxError` ; les dist de `dexie`/`hls.js` s'exécutent (audit post-68 : `?.`, `??`, `Array.prototype.flat`, `Object.fromEntries` — §2.2) ; rapport `Capabilities` journalisé.
- [ ] En cas d'échec de l'audit des deps : **NIVEAU 1 — interruption, décision humaine** (ajout éventuel d'un plugin de transpilation des deps = réouverture de spec §2).

---

## 4. Sprint 1 — Data Engine (staging, protocole PROT-1…6, recette fixtures)

**Objectif :** pipeline d'import playlist complet, prouvé par fixtures à assertions exactes.

| Tâche | Contenu | Réf spec |
|---|---|---|
| 1.1 | `src/data/db.js` verbatim : schéma + règle DB-1 (ids applicatifs `importId:seq` générés côté worker) | §5.1 |
| 1.2 | `src/data/DataManager.js` verbatim : `processingQueue`, respiration `document.hidden`, acquittement-sans-écriture après abort, **`failImport(importId, err)` publique**, transaction de purge bornée (`playlistId` + `kind`), `_routeAux`/`addAuxListener` | §5.3, PROT-5 |
| 1.3 | `src/data/ImportController.js` verbatim : fetch → `ReadableStream` → `TextDecoder({stream:true})` → watermark `MAX_INFLIGHT_TEXT=4` (un waiter par ack) → listeners de complétion attachés **avant** la pompe → PROT-6 (`import-busy`) → politique §5.4 (refus `Content-Length` absent ou > 30 Mo hors streaming) | §5.7–5.8 |
| 1.4 | `src/data/m3u.worker.js` : protocole §5.2 complet (`INIT_IMPORT`/`PARSE_CHUNK`(ici lignes M3U)/`CHUNK`(≤500)/`CHUNK_PARSED`/`CHUNK_COMMITTED`/`END_OF_STREAM`/`COMPLETE`/`ABORT_IMPORT`) ; tokenisation `#EXTINF`/`#EXTGRP` ; `searchName` normalisé (DB-3) | §6.4 |
| 1.5 | `bootstrap.js` : ordre §3 complet — Dexie → reprise sur crash §5.5 (imports `running`→`failed` + purge orphelins) → purge EPG §5.6 → **câblage `worker.onerror` avec injection explicite de l'importId** (§5.8, code fourni) → `workerFactory()` recréant la paire Worker/DataManager/ImportController après crash | §3, §5.5, §5.8 |
| 1.6 | Harnais `tests/` + fixtures M3U : `m3u-20000.m3u`, `duo-playlists.m3u`, double-déclenchement, abort à ~50 %, **abort pendant watermark plein** | §9 |

**Definition of Done (Sprint 1) :**
- [ ] Fixture `m3u-20000` : 20 000 lignes exactes, `activeImportId` permuté, groupes paginables via `[importId+groupName]`.
- [ ] Fixture `duo-playlists` : l'import B ne supprime **aucune** ligne de la playlist A (garde R2 historique).
- [ ] Double `startImport` : second rejeté (`import-busy`, PROT-6), premier intact.
- [ ] Abort : pas de swap, `status:'failed'`, worker débloqué, reboot sans orphelins.
- [ ] Crash worker simulé (exception injectée) : promesse rejetée via `import-error`, worker recréé au `startImport` suivant.
- [ ] Tous ces tests passent dans le navigateur contraint (harnais maison).

---

## 5. Sprint 2 — Pipeline Média (cœur de lecture)

**Objectif :** lecture Live/VOD déterministe avec fallback à passage unique, budget de reconnexion par moteur, et survie au passage en arrière-plan.

| Tâche | Contenu | Réf spec |
|---|---|---|
| 2.1 | `src/media/Watchdog.js` verbatim (one-shot `fired`, seuil 8 s) | §7.3 |
| 2.2 | `src/media/MediaAdapter.js` verbatim : machine d'état IDLE/LOADING/PLAYING/RECOVERING/ERROR/ENDED ; matrice §7.1 (startup → fallback MSE ; stall/error → RECOVERING intra-moteur ×1 **par moteur** ; 401/403 → ERROR sans retry ; `recoverMediaError` ×1) ; anti-race `requestId` + garde d'instance hls ; timeout startup 10 s bornant aussi RECOVERING ; `recoveryTimer` annulable ; `releaseHardware()` ≠ `destroy()` | §7.1–7.2 |
| 2.3 | `src/platform/LifecycleAdapter.js` verbatim : sauvegarde `{url, position, wasActive}` → `releaseHardware()` à `document.hidden` ; restauration au retour avec `urlResolver` injecté (ré-auth tokens) + re-seek VOD one-shot | §7.4 |
| 2.4 | Stubs de raccordement : `play(url)` exposé à l'UI du Sprint 3 ; événements `media-error` consignés | §7.2 |

**Definition of Done (Sprint 2) :**
- [ ] Banc local : flux MP4/HLS servis par un serveur de dev — natif d'abord, fallback MSE observé sur flux forçant l'échec natif (jamais de retour MSE → NATIVE).
- [ ] Zapping 50× rapide en banc : aucun événement tardif appliqué (requestId), aucune fuite d'instances hls.js.
- [ ] Coupure réseau 5 s (simulation proxy) : reprise sans intervention ≤ seuil ; 20 s : RECOVERING ×1 → fallback → ERROR propre ; 403 : ERROR immédiat, zéro retry.
- [ ] Passage en arrière-plan pendant lecture puis retour : pipeline détruit (VPU libéré) et **session restaurée** (VOD à la bonne position).

---

## 6. Sprint 3 — UI (FocusEngine, VirtualList, Overlay)

**Objectif :** navigation TV première (D-Pad + Magic Remote), liste de 20 000 chaînes à 60 FPS, zéro `innerHTML` sur données de flux.

| Tâche | Contenu | Réf spec |
|---|---|---|
| 3.1 | `src/ui/FocusEngine.js` verbatim : binds nommés, `init()` enregistre **keydown + mousemove**, seuil gyro 5 px, navigation 37/38/39/40, **activation 13 → `activateCurrent()` → événement `focus-activate`**, Back 461 → pile LIFO sinon `webOS.platformBack()` | §8.1 |
| 3.2 | `src/ui/VirtualList.js` verbatim : windowing + pool recyclé + `translateY`, scroll throttlé par rAF, `textContent` uniquement, `getRenderedNodeCount()` | §8.2, §1.2-6 |
| 3.3 | `src/ui/PlayerOverlay.js` : OSD lecture ; pousse/dépile ses handlers dans la pile Back ; contrôle d'import **désactivé pendant tout import** (PROT-6 côté UI) | §8.1, §5.2 |
| 3.4 | `src/styles/main.css` : layout 1920×1080 (aligné `resolution` appinfo), styles focus/mode pointeur (`body.magic-remote-active`) | §8 |
| 3.5 | Intégration données : liste alimentée par requêtes bornées Dexie (`[importId+groupName]` pagination, `searchName` startsWith) | §5.1 |

**Definition of Done (Sprint 3) :**
- [ ] 20 000 items : `getRenderedNodeCount() ≤ ⌈viewport/itemHeight⌉ + 2×overscan + 1` en permanence.
- [ ] Navigation D-Pad rapide continue : pas de tâche > 50 ms (profiler), mode pointeur non réactivé par les micro-tremblements (seuil 5 px vérifiable).
- [ ] OK (13) active la chaîne focalisée → `play()` du Sprint 2 ; Magic Remote : click natif fonctionnel en parallèle.
- [ ] Back 461 : OSD → menu → sortie plateforme, dans cet ordre.

---

## 7. Sprint 4 — EPG, **Connexion Xtream Codes**, Dual Player, Durcissement Store & Qualification TV

**Objectif :** parser XMLTV complet prouvé par fixtures, **import natif Xtream (URL + username + password : Live + VOD + infos compte)**, politique Dual Player, build store, et **qualification matérielle obligatoire** (condition de livraison).

| Tâche | Contenu | Réf spec |
|---|---|---|
| 4.1 | `src/data/epg.worker.js` verbatim : carryOver, regex durcie (attributs quotés tolérant `>` littéral), attributs sans ordre, CDATA/entités, dates 12/14 chiffres + offset `±HHMM`, PROT-1…4 (terminaison prouvée §6.2) | §6.1–6.4 |
| 4.2 | `src/media/DualPlayerPolicy.js` verbatim (allowlist `modelName`, `isWebOS6OrHigher` via rapport SDK §3, abonnement ≥ 2, hover 800 ms) ; désactivé par défaut | §7.5 |
| 4.3 | Fixtures EPG : `xmltv-644` (terminaison résiduelle), `xmltv-500-exact`, `xmltv-offsets`, `xmltv-dates-12`, `xmltv-attrs`, `xmltv-cdata`, `xmltv-coupe` (chunks 7 Ko) | §9 |
| 4.4 | **Connexion Xtream Codes** : `src/platform/XtreamClient.js` (validation base URL, builders d'endpoints account/catégories/listes/lecture/EPG) + `src/data/xtream.worker.js` (auth `user_info.status==='Active'` **avant toute écriture** → sinon `XTREAM_AUTH_FAILED` ; appels paginés par catégorie, mémoire bornée par catégorie ; mapping live → `channels`, films → `vod` ; `ACCOUNT_INFO` exposant `max_connections`) + extension `ImportController.startImport({ source:'xtream', base, username, password, … })` (PROT-6 identique, mêmes événements terminaux) + listener `ACCOUNT_INFO` → `DualPlayerPolicy.provider.maxConcurrentStreams`. UI : formulaire à 3 champs (URL / username / password) alimentant ce mode ; contrôle d'import verrouillé pendant l'opération (PROT-6). | §5.8, §6.5, §7.5 (XP-1…XP-4) |
| 4.5 | Fixtures Xtream : `xtream-mock.json` (comptes exacts channels+vod, `maxConnections` propagé), `xtream-auth-fail.json` (`XTREAM_AUTH_FAILED`, zéro écriture) ; plus import EPG via `{base}/xmltv.php?username&password` sur le pipeline §6 **inchangé** | §9, §6.5 |
| 4.6 | Build store : `IPTV_PRODUCTION=true` → `drop_console:true` (Q3) ; re-run du gate syntaxe Chromium 68 ; bump de version uniquement si requis par la soumission | §2.1 |
| 4.7 | **Qualification §11 sur TV physique webOS 5.0 (pré-requis Q2)** : T1 (50 zaps @500 ms + Home pendant lecture → reprise), T2 (soak 4 h, heap ≤ +20 %, relevés 30 min), T3 (60 FPS sur 20 000 chaînes pendant import EPG, aucune tâche > 50 ms), T4 (coupures 5 s/20 s → RECOVERING/fallback/ERROR bornés ; 403 → ERROR sans retry) | §11 |

**Definition of Done (Sprint 4) :**
- [ ] Les 7 fixtures EPG passent, comptes exacts vérifiés.
- [ ] Fixtures Xtream passent : 5 channels + 4 vod exacts sur le mock ; auth KO → erreur typée sans aucune écriture ; `max_connections: 2` → DualPlayerPolicy éligible (avec les autres portes).
- [ ] Connexion Xtream réelle (compte de test) : import complet → chaînes lisibles (Live), films lisibles (VOD), EPG via `xmltv.php` joint par `epg_channel_id`.
- [ ] `webosVersion` provient du SDK (vérifié sur device), Dual Player jamais actif sous 5.0, activable sur modèle allowlisté ≥ 6.0.
- [ ] **Rapport de qualification T1–T4 signé « sans réserve »** — sans lui, pas de livraison (§11 : « requiert le passage sans réserve »).
- [ ] `.ipk` de production packagé avec `appinfo.json` final.

---

## 8. Plan de vérification global

### 8.1 Automatisé (chaque sprint, navigateur contraint)
- `npm ci` + `npm run build` + gate syntaxe Chrome 68 headless (Sprints 0 et 4 minimum).
- Fixtures §9 via harnais maison (Q4) : assertion = compte exact de lignes + état `imports.status` + `activeImportId` final. Un écart = échec bloquant du sprint (ces fixtures existent précisément parce que ces défauts sont invisibles au build).

### 8.2 Manuel / matériel
- Émulateur webOS 5.0 : parcours import → liste → lecture → veille → reprise.
- TV physique : qualification T1–T4 (Sprint 4), non substituable.

---

## 9. Risques & mitigations

| Risque | Probabilité | Mitigation (déjà dans la spec) |
|---|---|---|
| Syntaxe/API post-68 dans dexie/hls.js | Moyenne | Gate Sprint 0 ; si échec → NIVEAU 1 (plugin transpilation deps = réouverture spec) |
| Quota IndexedDB dépassé (playlist géante + EPG) | Moyenne | `failImport` + `status:'failed'` + reprise au boot ; surveillance heap en T2 |
| Flux fournisseur exotiques (CORS/headers) | Élevée | Routage §5 spec : natif → MSE ; CORS bloqué = échec immédiat documenté (WARNING) |
| Absence de TV physique à J-qualif | — | Q2 : pré-requis métier à sécuriser dès le Sprint 0 (délai d'approvisionnement) |
| `webostvjs` interop module | Faible | **Résolu Sprint 0** : paquet sans export ESM (vérifié au build Rollup) → §3 corrigé V9.1 (`import 'webostvjs'` effet de bord + `window.webOS`) ; smoke test device toujours dû |
| Panels Xtream instables / throttlés | Élevée | appels **séquentiels** paginés par catégorie (mémoire bornée), catégorie fautive ignorée sans faire échouer l'import (XP-4), erreurs typées (`XTREAM_HTTP_*` / `XTREAM_AUTH_FAILED`) |
| Credentials Xtream en clair dans les URLs | Certain (par design) | interdiction de journalisation (XP-3), stockage acté en WARNING documenté |

---

## 10. Matrice de conformité Plan ↔ Spec V8

| Item de la spec | Sprint | Fichier | Statut |
|---|---|---|---|
| §2.1 package.json pinned | 0 | `package.json` | ✔ planifié |
| §2.2 vite iife/inline/chrome68 | 0 | `vite.config.js` | ✔ planifié |
| §4/§8 appinfo.json | 0 | `appinfo.json` | ✔ planifié |
| §3 CapabilityDetector (SDK+timeout) | 0 | `src/utils/CapabilityDetector.js` | ✔ planifié |
| §1.3 BaseComponent | 0 | `src/core/BaseComponent.js` | ✔ planifié |
| §5.1 schéma Dexie + DB-1…4 | 1 | `src/data/db.js` | ✔ planifié |
| §5.3 DataManager (+failImport) | 1 | `src/data/DataManager.js` | ✔ planifié |
| §5.7–5.8 ImportController + watermark | 1 | `src/data/ImportController.js` | ✔ planifié |
| §6.4 m3u.worker (protocole §5.2) | 1 | `src/data/m3u.worker.js` | ✔ planifié |
| §3 ordre bootstrap + §5.5 recovery + §5.6 purge + §5.8 onerror/factory | 1 | `src/bootstrap.js` | ✔ planifié |
| §9 fixtures M3U/protocole | 1 | `tests/fixtures/*` | ✔ planifié |
| §7.1–7.2 MediaAdapter | 2 | `src/media/MediaAdapter.js` | ✔ planifié |
| §7.3 Watchdog | 2 | `src/media/Watchdog.js` | ✔ planifié |
| §7.4 LifecycleAdapter | 2 | `src/platform/LifecycleAdapter.js` | ✔ planifié |
| §8.1 FocusEngine (13/461/5 px/pile Back) | 3 | `src/ui/FocusEngine.js` | ✔ planifié |
| §8.2 VirtualList windowing | 3 | `src/ui/VirtualList.js` | ✔ planifié |
| §8.1 consommateur pile Back (OSD) | 3 | `src/ui/PlayerOverlay.js` | ✔ planifié |
| §6.1–6.2 epg.worker (carryOver, fuseaux, PROT-3/4) | 4 | `src/data/epg.worker.js` | ✔ planifié |
| §7.5 DualPlayerPolicy | 4 | `src/media/DualPlayerPolicy.js` | ✔ planifié |
| §9 fixtures EPG | 4 | `tests/fixtures/*` | ✔ planifié |
| §6.5 XtreamClient (endpoints, validation) | 4 | `src/platform/XtreamClient.js` | ✔ planifié |
| §6.5 xtream.worker (auth, catégories, XP-1…4) + §5.8 mode xtream | 4 | `src/data/xtream.worker.js` + `ImportController` | ✔ planifié |
| §9 fixtures Xtream (mock, auth-fail) | 4 | `tests/fixtures/xtream-*.json` | ✔ planifié |
| §2.1 drop_console env (IPTV_PRODUCTION) | 4 | `vite.config.js` | ✔ planifié |
| §11 qualification T1–T4 (obligatoire) | 4 | rapport signé | ✔ planifié |

## 11. Hors périmètre (rappel opposable §12)

DRM/Widevine, multi-audio/sous-titres, CH+/CH− et pavé couleurs, timeshift/catch-up/enregistrement, multi-profil : **non implémentés en v1.0**. L'arbitrage DRM relève d'une décision métier écrite (§12) — en l'absence de validation contraire, aucun de ces sujets n'entre dans un sprint.

---

**Prochaine étape :** approbation de ce plan + réponse aux questions ouvertes Q1–Q4 → démarrage Sprint 0.
