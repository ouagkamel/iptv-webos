# Revue UI VisionTV — révision V22 « Lumina IPTV »

**Date :** 2026-09-13
**Base fonctionnelle :** V21 publiée, commit `3b53fab`, tag `v21`
**Révision :** V22 UI incrémentale, implémentée localement, non encore publiée
**Référence visuelle :** `/home/user/uploads/DESIGN.md` et les six prototypes HTML joints

## Verdict

**WARNING — révision UI validée par analyse statique, tests, gate Chromium 68, build et ressources servies par Vite ; validation CDP/webOS réel encore indisponible.**

La V22 ne réécrit pas le moteur métier. Elle réutilise Dexie, les imports M3U/Xtream/XMLTV, la persistance des playlists, le chargement lazy, `VirtualList`, `SeriesBrowser`, `MediaAdapter`, `LifecycleAdapter`, le GC lazy et le routeur D-Pad existants. Les changements applicatifs se concentrent sur la composition de `src/app.js`, le thème natif de `src/styles/main.css` et la classification de l’onglet Guide dans `src/ui/RemoteKeys.js`.

## Traçabilité de la révision

| Référence | Décision V22 | Emplacement |
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

## Correspondance avec la demande

| Exigence | État | Vérification / réalisation |
|---|---|---|
| Direction sombre « Luminous Cinema / Lumina IPTV » | OK | Fond ardoise profond, surfaces titanium/slate, cyan électrique, cobalt et indigo ; aucun fond pastel résiduel dans le nouveau thème. |
| Interface 10-foot webOS | OK statique | Safe-area par variables de gouttière, titres contrastés, métadonnées lisibles, barre de raccourcis Magic Remote et focus cyan visible. |
| Sidebar compacte de 96 px extensible au focus | OK statique | Rail 96 px, icônes SVG inline, libellés masqués au repos, expansion `:focus-within` sans dépendance externe. |
| Accueil / Découverte | OK | Hero, données live réelles, fallback local par lettre/dégradé, quatre univers, rangées de cartes et accès Guide. |
| Profils « Qui regarde la télévision ? » | OK | Sélection du profil actif, état vide, cartes persistées et bouton d’ajout. |
| Ajout Xtream / M3U | OK | Modal native, onglets sans `<select>` visible, champs conditionnels, création via `ctx.manager.create()`, erreurs visibles. |
| Catalogue films et séries | OK | Familles chargées séparément, filtres de catégories, recherche préfixe, séries ouvertes via `SeriesBrowser`, lecture épisode conservée. |
| Live TV / EPG en trois zones | OK | Bouquets, liste de chaînes et détail EPG ; l’EPG exploite le véritable `activeEpgImportId` et reste optionnel si aucune synchronisation n’est disponible. |
| Favoris et profil actif | PARTIEL / WARNING | Le profil actif est relié aux données persistées ; la vue Favoris est un point d’entrée visuel. Le modèle métier de favoris n’existait pas en V20/V21, donc aucune fausse persistance n’a été introduite. |
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
- `clearCatalogMemory()` conserve la stratégie V20 : une famille catalogue active en mémoire UI ; le Guide partage le chargement live au lieu de copier le tableau.
- Les catégories continuent d’être demandées via `ctx.manager.categories()` et l’ordre serveur est conservé avant les groupes de secours rencontrés dans les lignes.
- `VirtualList` reste le composant utilisé pour Live, Films, Séries et le centre du Guide ; aucun tableau de 20 000 cartes n’est créé dans le DOM.

### Lecture, séries et EPG — PASS statique

- Le lecteur overlay à la demande reste partagé entre live, VOD et épisodes.
- `MediaAdapter`, `LifecycleAdapter`, OSD, pause, muet, timeline, seek, plein écran et zapping sont conservés.
- Le Guide ouvre une chaîne live sans créer un second lecteur.
- `activeEpgImportId` est utilisé pour afficher le programme courant/suivant ; en absence d’EPG, l’interface reste navigable.
- Le parcours séries reste lazy et l’import n’est pas touché par un échec de détail.

### Compatibilité, sécurité et dépendances — PASS statique

- Les noms, groupes, programmes et erreurs IPTV sont écrits par `textContent` ; aucun rendu IPTV par `innerHTML` n’a été introduit.
- Les logos distants sont ceux déjà fournis par la source IPTV ; le fallback est local (lettre, SVG, CSS), sans image externe imposée.
- Les identifiants Xtream ne sont pas journalisés.
- Les feuilles de style et scripts applicatifs ne dépendent d’aucun CDN.
- Les surfaces utilisent des aplats et gradients légers ; aucune boucle d’animation permanente ou `backdrop-filter` n’a été ajoutée.

## Points non certifiés — WARNING

1. `tools/browser-run.mjs` n’a pas pu certifier le boot, le focus, la modal, le Guide et le lecteur : `chrome-headless-shell`/Chromium n’est pas installé dans l’environnement et l’installation système sans root échoue.
2. La preview Vite sert correctement le shell, `main.css` et `app.js`, mais elle ne remplace pas une validation sur téléviseur webOS et télécommande réelle.
3. Le bundle principal reste supérieur à 500 kB après minification (environ 582,54 kB dans cette révision) ; l’avertissement Vite est connu, non bloquant et sans nouvelle dépendance UI.
4. La vue Favoris n’a pas de stockage métier V22, conformément à la décision de ne pas inventer un modèle de données absent de V20/V21.

## Validation exécutée

```text
npm test                         PASS — 90/90
npm run gate:syntax              PASS — 25 fichiers compatibles Chromium 68
npm run build                    PASS — Vite ; bundle principal ~582,55 kB minifié
curl shell / CSS / app           PASS — ressources servies par la preview Vite
npm install --ignore-scripts     PASS — environnement de test restauré (fake-indexeddb)
```

La preview est disponible sous le processus **VisionTV preview** lancé sur le port Vite. La sonde navigateur réelle reste à relancer dès qu’un binaire Chrome/webOS est disponible.

## Fichiers modifiés dans la révision

- `src/app.js` — shell topbar/footer, rail, Accueil, univers, Guide EPG, paramètres, profils et thème de composition ; moteur métier conservé.
- `src/styles/main.css` — nouveau système Lumina sombre, safe-area, rail 96 px extensible, hero, cartes, Guide, paramètres, lecteur et focus TV.
- `src/ui/RemoteKeys.js` — prise en charge de l’onglet `guide` dans le classement des touches de liste.
- `docs/REVIEW-VISIONTV-UI.md` — traçabilité et protocole de revue V22.
