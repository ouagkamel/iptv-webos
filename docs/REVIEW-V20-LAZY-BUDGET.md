# Revue V20 — catalogue lazy et budget média prioritaire

**Date :** 2026-09-13  
**Baseline :** V19 publiée, Dexie V4, webOS 5 / Chromium 68  
**Spécification synchronisée :** `SPEC-IPTV-webOS-V6-FINAL.md` (révision V20)

## Verdict selon le protocole de la spécification

- **BLOCKING : aucun.** Les deux optimisations restent compatibles avec le
  protocole d’import V18/V19 et ne touchent ni la migration V3→V4 ni le swap
  atomique.
- **WARNING :** la qualification sur TV/émulateur webOS réelle reste à faire
  (décodeur, VPU, D-pad et comportement de suspension). Le warning Vite sur le
  bundle supérieur à 500 kB et les warnings GPU/DBus du headless Chrome sont
  non bloquants et déjà documentés dans le README.
- **Blob/JSON par catégorie :** toujours non activé, conformément à la décision
  V19 et aux risques de taille de record, RAM, reprise et migration.

## Vérification des critères d'acceptation

### 1. Chargement lazy d'un seul catalogue

- `src/app.js` ne fait plus de `Promise.all()` global pour `live`, `vod` et
  `series`.
- `KIND_TO_MANAGER` mappe explicitement `live → channels`, `vod → vod` et
  `series → series`; un seul appel est lancé pour l'onglet actif.
- Chaque changement d'onglet ou de playlist incrémente `catalogLoadToken`, vide
  `state.items` et `VirtualList.items` des trois familles, remet les catégories
  à zéro et libère les tableaux précédents.
- Les réponses vérifient le jeton, la playlist et l'onglet après chaque
  `await`; une réponse obsolète ne peut pas réinjecter de lignes ni de
  catégories.
- `VirtualList` efface aussi le texte et `data-index` des nœuds recyclés quand
  une liste est vidée.
- Les catégories sont demandées uniquement pour la famille active.
- `import-complete` recharge uniquement la vue active pour `kind: playlist`;
  un `kind: epg` ne relit aucun catalogue.
- Le filtre, la recherche préfixe et le zap continuent d'utiliser la
  `VirtualList` de la famille active.

### 2. Budget CPU/mémoire pendant la lecture

- `MediaAdapter` publie `media-playback-state` et maintient
  `window.__iptvPlaybackActive` lors de `play`, `stop`, `ended`, erreur,
  `releaseHardware` et destruction.
- Un `DataManager` existant relaie chaque changement aux workers par
  `SET_IMPORT_BUDGET`; un `DataManager` créé après le début de la lecture lit
  aussi le snapshot global au constructeur.
- Les trois workers conservent deux chunks maximum hors lecture et passent à
  un seul chunk pendant la lecture : M3U, XMLTV et Xtream.
- `DataManager` force un yield UI par chunk en lecture; hors lecture le régime
  quatre chunks/profil V18/V19 reste inchangé.
- La GC/purge par lots de 500 attend jusqu'à 500 ms ou est réveillée dès que la
  lecture s'arrête; elle ne supprime jamais l'import actif et reste hors de la
  transaction de swap.
- `LifecycleAdapter` appelle `releaseHardware` en arrière-plan, ce qui restaure
  le budget normal avant la suspension.
- `bulkAdd`, les ACK ciblés, la validation des chunks, `COMPLETE`, le swap
  atomique et la sécurité contre la purge de l'actif sont inchangés.

## Changements livrés

| Zone | Fichiers | Résultat |
|---|---|---|
| UI/catalogues | `src/app.js`, `src/ui/VirtualList.js` | chargement mono-catalogue, garde anti-race, vidage des références |
| Budget import | `src/data/DataManager.js` | signal média, yield par lot, GC ralentie/réveillable |
| Workers | `src/data/m3u.worker.js`, `src/data/epg.worker.js`, `src/data/xtream.worker.js` | plafond dynamique 2 → 1 → 2 |
| Lecteur | `src/media/MediaAdapter.js` | publication globale active/inactive |
| Régressions | `tests/lazy-catalog.test.mjs`, `tests/media.test.mjs`, `tests/protocol.test.mjs`, `tests/xtream.test.mjs` | couverture statique, média, M3U/EPG/Xtream et GC |
| Documentation | README et les trois copies de la spécification | traçabilité V20 synchronisée |

## Validation exécutée

| Validation | Résultat |
|---|---:|
| `npm test` | **90/90** |
| `npm run gate:syntax` | **25 fichiers OK**, Chromium 68 |
| `npm run build` | **OK**, 532,77 kB |
| `IPTV_PRODUCTION=true npm run build` | **OK**, 531,01 kB |
| Gate syntaxe `dist` | **OK**, 1 fichier; 2 occurrences dépendance sous garde tolérées |
| Recherche `console.*` dans `dist` | **aucune occurrence interdite** |
| Boot build production headless | **APP PASS** — 4 onglets, aucune console de page |
| Smoke navigateur réel | **SMOKE PASS (8/8)** |
| Harness §9 navigateur réel | **HARNESS PASS (9/9)** |
| Probe UI live → vod → series avec listes différées | **LAZY PASS** |

Les warnings GPU/DBus du headless Chrome n'ont pas affecté les verdicts. La
validation matérielle webOS reste la prochaine étape avant une éventuelle
publication V20.
