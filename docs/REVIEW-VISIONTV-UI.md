# Revue UI VisionTV — première intégration

**Date :** 2026-09-13  
**Base fonctionnelle :** V20 publiée, `9cd8ddf`  
**Révision :** refonte visuelle native webOS, non publiée dans une nouvelle release

## Verdict

**WARNING — intégration UI validée statiquement et par build/tests, sonde navigateur non exécutable dans cet environnement.**

Aucune modification n’a été apportée aux protocoles d’import, à Dexie, aux migrations, au lecteur `MediaAdapter`, à `VirtualList` ou au GC lazy. La refonte est concentrée sur `src/app.js`, `src/styles/main.css` et le titre du shell HTML.

## Correspondance avec la demande

| Exigence | État | Réalisation |
|---|---|---|
| Identité VisionTV / écran profils | OK | Marque VisionTV, écran « Qui regarde la TV ? », cartes de profils et illustration moniteur pour l’état vide. |
| Ajout d’accès Xtream / M3U | OK | Modal « Ajouter un accès », onglets natifs `Compte Xtream` / `Lien M3U`, champs conditionnels, message d’erreur et conservation du chemin `ctx.manager.create()`. |
| Dashboard « Découverte » | OK | Vue home, hero, métadonnées, description, horloge, profil actif, rangées bornées de chaînes et contenus. |
| Données réelles | OK | Les cartes utilisent les éléments issus des `VirtualList`/catalogues réels et leurs logos lorsqu’ils existent ; aucun `MOCK_DATA` n’est introduit. Fallback local par lettre, dégradé et SVG inline. |
| Navigation Accueil / Direct / Films / Séries / Favoris / Paramètres | OK | Rail latéral D-pad avec boutons et icônes SVG inline. Favoris et paramètres disposent de vues dédiées légères. |
| Lecteur et OSD | OK | Overlay plein écran conservé ; retour, lecture/pause, volume muet, timeline, ±10 s, plein écran, OSD EPG et statut ajoutés. Les touches webOS existantes restent routées par `RemoteKeys`. |
| Focus télécommande | OK | Focus visible, `Enter`/OK via `FocusEngine`, retour LIFO du lecteur, du panneau série et de la modal, focus limité aux éléments visibles de la modal. |
| Virtualisation / lazy loading | OK | `VirtualList` inchangé et toujours borné. L’accueil ne demande qu’un catalogue `live`; les onglets `vod` et `series` restent chargés séparément. |
| webOS 5 / Chromium 68 | OK statique | CSS natif, SVG inline, pas de React, Tailwind, Lucide, Google Fonts, CDN, `backdrop-filter` ou animation permanente. Les transitions de focus restent légères. |

## Analyse des régressions potentielles

### Import, données et lecture — PASS

- `ensureDefaultPlaylist()` est toujours appelé avant l’interface utilisable et le bouton d’import.
- `runImport()`, les événements `import-complete`, `import-error` et `import-aborted` restent branchés.
- La garde V20 de catalogue actif est préservée ; l’accueil utilise explicitement `live` comme unique aperçu.
- `VirtualList` n’a pas été remplacée par une grille complète : les catalogues continuent d’utiliser le pool recyclé.
- Le chemin séries (`SeriesBrowser`, saisons, épisodes) reste inchangé fonctionnellement.
- Le lecteur reste créé à la demande et partage toujours `MediaAdapter` / `LifecycleAdapter`.

### Compatibilité et sécurité — PASS statique

- Aucun rendu de données IPTV par `innerHTML` n’a été ajouté : textes et métadonnées passent par `textContent` ; le nettoyage des listes reste borné au DOM UI.
- Les URLs de logos sont celles déjà fournies par les playlists. En leur absence, les cartes utilisent des assets visuels locaux générés par CSS/SVG.
- Les identifiants Xtream ne sont toujours pas journalisés.
- Le CSS ne dépend d’aucun réseau externe.

### Points non certifiés — WARNING

1. La sonde CDP `tools/browser-run.mjs` n’a pas pu être exécutée : le binaire `chrome-headless-shell` n’est pas présent dans ce snapshot et l’installation système est interdite sans privilèges root.
2. Le build conserve l’avertissement Vite de bundle principal supérieur à 500 kB, déjà connu en V20 ; ce n’est pas un échec de build et aucune dépendance UI externe n’a été ajoutée.
3. La vue Favoris est un point d’entrée et un état vide visuel ; le dépôt V20 ne possède pas de modèle de favoris persistant existant à préserver. Une persistance métier peut faire l’objet d’une révision dédiée sans toucher à l’import.

## Validation exécutée

```text
npm test                         PASS — 90/90
npm run gate:syntax              PASS — 25 fichiers Chromium 68
npm run build                    PASS — bundle production généré
curl shell / CSS / app           PASS — ressources servies par Vite
```

Le serveur de prévisualisation local est lancé par le processus **VisionTV preview** sur le port Vite ; la validation visuelle finale sur Chromium/webOS réel reste à effectuer lorsque le binaire navigateur ou le téléviseur est disponible.

## Fichiers modifiés

- `index.html` — titre du shell `VisionTV`.
- `src/app.js` — rail VisionTV, home, profils/modal, vues Favoris/Paramètres, cartes données réelles, contrôles lecteur et routage de focus.
- `src/styles/main.css` — nouvelle palette pastel, layout TV, focus, modal, cartes, OSD et styles compatibles avec les contraintes webOS.
