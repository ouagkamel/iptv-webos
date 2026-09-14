# Revue UI VisionTV — révision V28 « accueil premium éditorial »

**Date :** 2026-09-14
**Base fonctionnelle :** V27 publiée, commit `c2e1499`, tag `v27`
**Révision :** V28 — refonte de la seule page Accueil en interface streaming premium, en attente de validation utilisateur avant extension aux autres écrans
**Référence visuelle :** `/home/user/uploads/accueil.html`, `/home/user/uploads/catalogue_vod_films_s_ries.html` et `/home/user/uploads/live_tv_guide_des_programmes_epg.html`

## Verdict

**WARNING — V28 est une proposition d’Accueil prête pour validation : gate, tests et build PASS ; validation visuelle CDP/webOS réel et validation utilisateur encore indisponibles.**

La V28 ne réécrit pas le moteur métier et ne modifie pas les vues catalogue, Guide, profils, paramètres ou lecteur. Elle reste limitée à la page Accueil et à son chargement éditorial. Elle réutilise Dexie, les imports M3U/Xtream/XMLTV, la persistance des playlists, le chargement lazy, `VirtualList`, `SeriesBrowser`, `MediaAdapter`, `LifecycleAdapter`, le GC lazy et le routeur D-Pad existants. Les changements applicatifs se concentrent sur la composition de `src/app.js`, le thème natif de `src/styles/main.css`, le worker EPG et les tests de collision ; le moteur d’import, le lecteur natif et la classification D-Pad restent en place.

## Traçabilité de la révision

| Référence | Décision / réalisation | Emplacement |
|---|---|---|
| V21 / revue précédente | Conserver le lecteur overlay, la liste virtuelle, le chargement d’une seule famille de catalogue et le focus existant. | `src/app.js`, `src/ui/VirtualList.js` |
| `DESIGN.md` — surface `#051424`, titanium/slate, cyan/cobalt/indigo | Nouveau thème sombre sans dépendance, avec variables CSS et surfaces opaques légères. | `src/styles/main.css` |
| `DESIGN.md` — rail 96 px extensible | Rail compact de 96 px ; expansion à 250 px au `:focus-within` (270 px sur grand écran), libellés masqués au repos. | `.vision-sidebar`, `.vision-sidebar:focus-within` |
| Prototypes Accueil / Découverte | Hero éditorial, accès Direct TV / Films / Séries / Guide, rangées horizontales bornées, profil actif et statut technique. | `buildHomeView()` |
| Prototype profils | Écran « Qui regarde la TV ? », cartes de profils, état vide, modal d’ajout Xtream/M3U. | `buildPlaylistsView()` |
| Prototype catalogue VOD | Titres Films/Séries, recherche, filtre de catégorie serveur, lignes recyclées et lecture. | `buildListView()` |
| Prototype Guide TV | Guide en trois zones : bouquets, chaînes, détail programme ; recherche, EPG réel et action lecture. | `buildGuideView()` |
| Prototype paramètres | Menu de sections, lecteur natif/HLS secours, buffer indicatif, synchronisation, EPG, diagnostic et matériel. | `buildSettingsView()` |
| Correction de cohérence EPG | Le détail Guide et l’OSD lisent désormais l’import `activeEpgImportId`, sans modifier le pipeline d’import. | `renderGuideDetail()`, `showEpgFor()` |
| Routeur télécommande | `guide` rejoint les onglets classés par `RemoteKeys`, sans voler OK/flèches dans les champs. | `src/ui/RemoteKeys.js` |
| V23 — favoris persistants | Ajout d’un store Dexie V5 par playlist/type/sourceKey, nettoyage à la suppression du profil et purge des snapshots orphelins. Les lignes virtuelles réutilisent un bouton étoile sans dépasser le pool DOM. | `src/data/db.js`, `src/services/PlaylistManager.js`, `src/ui/VirtualList.js`, `src/app.js` |
| V24 — action Favori D-Pad | Le lecteur partagé expose une action Favori focalisable dans ses contrôles. Live, VOD et épisode de série réutilisent le même snapshot et restent synchronisés avec la vue Favoris. | `src/app.js`, `src/styles/main.css` |
| V25 — écrans transmis intégrés | Films/VOD reçoit un hero spotlight, filtres de genres, recherche, cartes/carrousels bornés et ajout récent ; Séries conserve l’accès saisons/épisodes lazy ; Live TV reçoit bouquets, liste, prévisualisation et EPG réel. Les actions restent reliées aux listes, au lecteur, aux favoris et au D-pad. | `buildListView()`, `buildCatalogShelves()`, `buildLivePreview()`, `src/styles/main.css` |
| V25 — collision EPG | Les programmes XMLTV valides reçoivent un ordinal primaire monotone à l’intérieur de l’import. Le couple `importId/channelId/startTime` reste indexé pour les requêtes EPG ; les doublons XMLTV ne font plus échouer `bulkAdd`, y compris après la frontière du lot 2 000. | `src/data/epg.worker.js`, `tests/epg-import.test.mjs` |
| V26 — palette, rail et D-pad | Les couleurs principales reprennent les tokens des prototypes (`#051424`, `#0d1c2d`, `#122131`, `#1c2b3c`, `#273647`, `#4cd7f6`, `#0566d9`). Le rail gauche est fixe, se déploie au survol/focus comme le prototype et ne décale plus le contenu. Haut/Bas pilotent uniquement les lignes Live/VOD/Séries/Guide ; la ligne sélectionnée est focalisée et surlignée. | `src/styles/main.css`, `src/app.js` |
| V27 — Accueil fourni | Le prototype `accueil.html` est adapté sans CDN : hero de 420 px, badge Direct 4K, marque/status Lumina, rangée « Chaînes Favorites & Reprises Rapides », cartes alimentées par le profil actif et accès rapides. Les boutons Regarder/Guide/favoris et les touches couleur restent branchés aux vues réelles. | `buildHomeView()`, `renderHomeView()`, `buildTopbar()`, `buildFooter()`, `src/styles/main.css` |
| V28 — Accueil premium en validation | Refonte ciblée de l’Accueil : hero immersif, rails horizontaux inspirés streaming, matchs live détectés dans l’EPG, derniers films du catalogue, derniers épisodes via `SeriesBrowser` lazy/cache et favoris persistants. Le profil actif, les actions natives, le D-pad et les fallbacks locaux restent réels ; aucune donnée fictive n’est ajoutée. | `buildHomeView()`, `renderHomeView()`, `hydrateHomeSections()`, `renderHomeRail()`, `src/styles/main.css` |

## Correspondance avec la demande

| Exigence | État | Vérification / réalisation |
|---|---|---|
| Direction sombre « Luminous Cinema / Lumina IPTV » | OK V27 | Fond ardoise profond, surfaces titanium/slate, cyan électrique, cobalt et indigo ; aucun fond pastel résiduel dans le nouveau thème. |
| Interface 10-foot webOS | OK statique V27 | Safe-area par variables de gouttière, titres contrastés, métadonnées lisibles, barre de raccourcis Magic Remote et focus cyan visible. |
| Sidebar compacte de 96 px extensible au focus | OK V27 | Rail fixe 96 px, expansion au survol/focus vers 320 px, libellés visibles à l’ouverture, contenu principal non décalé. |
| Accueil / Découverte | EN ATTENTE VALIDATION V28 | Hero immersif, rails « En direct maintenant », « Derniers films ajoutés », « Derniers épisodes » et « Vos favoris » ; EPG réel, `SeriesBrowser` lazy/cache, fallbacks locaux et actions natives. |
| Profils « Qui regarde la télévision ? » | OK | Sélection du profil actif, état vide, cartes persistées et bouton d’ajout. |
| Ajout Xtream / M3U | OK | Modal native, onglets sans `<select>` visible, champs conditionnels, création via `ctx.manager.create()`, erreurs visibles. |
| Catalogue films et séries | OK V27 | Hero/spotlight, recherche, filtres/pills, carrousels bornés et ajouts récents pour Films/Séries ; familles chargées séparément, séries ouvertes via `SeriesBrowser`, lecture épisode conservée. |
| Live TV / EPG en trois zones | OK V27 | Bouquets, liste de chaînes, aperçu de lecture et détail EPG ; le Guide garde ses trois zones et l’EPG exploite le véritable `activeEpgImportId`. |
| Favoris et profil actif | OK V23 | Nouveau store Dexie V5 `favorites`, snapshots bornés à 100 éléments affichés, ajout/retrait depuis Accueil, lignes catalogues et Guide, séparation par playlist et purge des orphelins. |
| Paramètres webOS, lecteur, synchronisation | OK | Vue paramètres détaillée, actions de synchronisation/EPG, statut catalogue et rappel du lecteur natif/HLS secours. |
| Données IPTV réelles et logos | OK | Les cartes et lignes utilisent les données des catalogues actifs ; logo fourni utilisé quand présent, fallback SVG/CSS local sinon. Aucun jeu de données fictif ajouté. |
| Pas de dépendances UI externes | OK | Pas de Tailwind CDN, Google Fonts, Material Symbols CDN, images CDN, React ou autre librairie UI ; CSS natif et SVG inline uniquement. |
| DOM borné / focus déterministe | OK | `VirtualList` inchangé ; pool de lignes recyclé ; écouteurs délégués ; focus modal/lecteur/série et back LIFO conservés. |
| Compatibilité webOS / Chromium 68 | OK statique | Gate syntaxe réussi ; pas de `backdrop-filter`, de blur lourd, d’animations permanentes ni d’API UI moderne non nécessaire. |

## Analyse des régressions potentielles

### Import, base et mémoire — PASS

- `ensureDefaultPlaylist()` reste exécuté avant le chemin Importer.
- `runImport()` garde les chemins `importPlaylist()` et `importEpg()` ainsi que les événements `import-complete`, `import-error` et `import-aborted`.
- Aucun protocole worker, mapping compact, taille de chunk, budget de lecture ou règle GC n’a été modifié.
- `clearCatalogMemory()` conserve la stratégie V20 pour les vues catalogue ; l’Accueil charge les trois familles déjà persistées afin de construire ses rails éditoriaux, sans créer de second tableau DOM virtuel.
- Les catégories continuent d’être demandées via `ctx.manager.categories()` et l’ordre serveur est conservé avant les groupes de secours rencontrés dans les lignes.
- Le worker EPG ne fabrique plus plusieurs lignes avec la même clé primaire : chaque programme valide reçoit `importId:channelId:startTime:ordinal`. L’index composé utilisé par le Guide n’est pas changé ; deux programmes qui partagent chaîne et début restent donc lisibles comme deux entrées.
- Les tests couvrent un doublon dans un même lot et une collision après le lot 2 000 ; `bulkAdd` de production reste le seul chemin d’écriture.
- `VirtualList` reste le composant utilisé pour Live, Films, Séries et le centre du Guide ; aucun tableau de 20 000 cartes n’est créé dans le DOM.
- Dans les onglets de contenu, `FocusEngine` reçoit uniquement les lignes visibles de la `VirtualList` : les boutons de catégories ne capturent plus Haut/Bas à la place des chaînes/films. Les champs de recherche et sélecteurs conservent leurs événements natifs.
- Chaque ligne active reçoit `aria-selected=true`, une bordure cyan et une surface `#1c2b3c` ; le focus suit `state.selIndex` après déplacement, changement de page et recherche.

### Lecture, séries et EPG — PASS statique

- Le lecteur overlay à la demande reste partagé entre live, VOD et épisodes.
- `MediaAdapter`, `LifecycleAdapter`, OSD, pause, muet, timeline, seek, plein écran et zapping sont conservés.
- Le Guide ouvre une chaîne live sans créer un second lecteur.
- `activeEpgImportId` est utilisé pour afficher le programme courant/suivant ; en absence d’EPG, l’interface reste navigable.
- Le parcours séries reste lazy et l’import n’est pas touché par un échec de détail.

### Favoris persistants — PASS

- Le store Dexie V5 est additif : les stores existants, les migrations V1→V4 et les lectures EPG/catalogues ne sont pas modifiés.
- Chaque snapshot est lié à une playlist et à une `sourceKey` déterministe ; deux profils ne partagent pas leurs favoris.
- Les boutons étoile sont disponibles depuis les cartes Accueil, les lignes `VirtualList` des catalogues, le Guide EPG et les contrôles focalisables du lecteur. Le nœud virtuel vide son snapshot quand il est recyclé ou déchargé.
- La vue Favoris affiche les 100 éléments les plus récents, avec fallback de logo local et actions lecture/retrait.
- La suppression d’une playlist et la maintenance de boot suppriment les snapshots associés/orphelins ; l’import actif n’est pas touché.

### Compatibilité, sécurité et dépendances — PASS statique

- Les noms, groupes, programmes et erreurs IPTV sont écrits par `textContent` ; aucun rendu IPTV par `innerHTML` n’a été introduit.
- Les logos distants sont ceux déjà fournis par la source IPTV ; le fallback est local (lettre, SVG, CSS), sans image externe imposée.
- Les identifiants Xtream ne sont pas journalisés.
- Les feuilles de style et scripts applicatifs ne dépendent d’aucun CDN.
- Les surfaces utilisent des aplats et gradients légers ; aucune boucle d’animation permanente ou `backdrop-filter` n’a été ajoutée.

## Points non certifiés — WARNING

1. `tools/browser-run.mjs` n’a pas pu certifier le boot, le focus, la modal, le Guide et le lecteur : `chrome-headless-shell`/Chromium n’est pas installé dans l’environnement et l’installation système sans root échoue.
2. La preview Vite sert correctement le shell, `main.css` et `app.js`, mais elle ne remplace pas une validation sur téléviseur webOS et télécommande réelle.
3. Le bundle principal reste supérieur à 500 kB après minification (environ 635,09 kB dans cette proposition V28) ; l’avertissement Vite est connu, non bloquant et sans nouvelle dépendance UI.
4. La vue Favoris est maintenant persistante en V23 ; la limitation volontaire porte sur les 100 éléments affichés afin de conserver une UI TV bornée.

## Validation exécutée

```text
npm test                         PASS — 95/95
npm run gate:syntax              PASS — 25 fichiers compatibles Chromium 68
npm run build                    PASS — Vite ; bundle principal ~635,09 kB minifié
curl shell / CSS / app           PASS — ressources servies par la preview Vite
npm install --ignore-scripts     PASS — environnement de test restauré (fake-indexeddb)
```

La preview peut être relancée via Vite ; aucune validation navigateur réelle n’a été ajoutée dans cette révision. La sonde navigateur réelle reste à relancer dès qu’un binaire Chrome/webOS est disponible.

## Fichiers modifiés dans la révision

- `src/app.js` — refonte Accueil V28, chargement éditorial live/VOD/séries, EPG de matchs, épisodes lazy/cache, rails et actions ; autres vues conservées.
- `src/styles/main.css` — direction streaming premium de l’Accueil, hero immersif, rails, cartes, états vides/chargement, focus et safe-area TV ; styles des autres vues conservés.
- `src/ui/RemoteKeys.js` — prise en charge de l’onglet `guide` dans le classement des touches de liste.
- `src/data/db.js` — store Dexie V5 additif pour les favoris.
- `src/services/PlaylistManager.js` — suppression/purge des favoris associés aux profils.
- `src/ui/VirtualList.js` — renderer applicatif optionnel, sans changer le pool borné ni le rendu texte.
- `src/data/epg.worker.js` — ordinal primaire EPG borné par import, sans table de déduplication en mémoire.
- `tests/epg-import.test.mjs` — doublons intra-lot et après frontière de chunk, en plus des fixtures XMLTV existantes.
- `tests/favorites.test.mjs` — tests du schéma, de l’isolation entre profils et de la purge.
- `docs/REVIEW-VISIONTV-UI.md` — traçabilité et protocole de revue V22/V23/V24/V25/V26/V27/V28.
